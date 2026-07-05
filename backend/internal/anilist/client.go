// Package anilist is the upstream metadata subsystem: a rate-limited GraphQL
// client, the sync pipeline that mirrors AniList data into Postgres, and the
// fixture loader that replaces the network in demo mode.
package anilist

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

const DefaultURL = "https://graphql.anilist.co"

// AniList's degraded rate limit is 30 req/min; stay comfortably under it.
// One in-flight request at a time keeps burst behavior trivial to reason about.
var defaultLimiter = rate.NewLimiter(rate.Every(2200*time.Millisecond), 2)

const maxAttempts = 4

// Overridable in tests to keep retry paths fast.
var (
	transportRetryDelay = 2 * time.Second
	upstreamRetryDelay  = 3 * time.Second
)

type Client struct {
	url     string
	http    *http.Client
	limiter *rate.Limiter
	log     *slog.Logger
}

func NewClient(log *slog.Logger, opts ...ClientOption) *Client {
	c := &Client{
		url:     DefaultURL,
		http:    &http.Client{Timeout: 20 * time.Second},
		limiter: defaultLimiter,
		log:     log,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

type ClientOption func(*Client)

// WithURL points the client at a test server.
func WithURL(url string) ClientOption { return func(c *Client) { c.url = url } }

// WithLimiter overrides the request pacing (tests use an unlimited one).
func WithLimiter(l *rate.Limiter) ClientOption { return func(c *Client) { c.limiter = l } }

type gqlRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables"`
}

type gqlError struct {
	Message string `json:"message"`
}

type gqlEnvelope struct {
	Data   json.RawMessage `json:"data"`
	Errors []gqlError      `json:"errors"`
}

// do executes a GraphQL query with rate limiting and retry/backoff.
// Retries: 429 honors Retry-After; 5xx and transport errors back off
// exponentially. GraphQL-level errors are semantic and never retried.
func (c *Client) do(ctx context.Context, query string, vars map[string]any, dest any) error {
	body, err := json.Marshal(gqlRequest{Query: query, Variables: vars})
	if err != nil {
		return fmt.Errorf("anilist: encode request: %w", err)
	}

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := c.limiter.Wait(ctx); err != nil {
			return err
		}

		retryIn, err := c.attempt(ctx, body, dest)
		if err == nil {
			return nil
		}
		lastErr = err
		if retryIn < 0 { // not retryable
			return err
		}
		c.log.Warn("anilist request failed, retrying",
			"attempt", attempt, "retry_in", retryIn, "err", err)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(retryIn):
		}
	}
	return fmt.Errorf("anilist: giving up after %d attempts: %w", maxAttempts, lastErr)
}

// attempt runs one HTTP round trip. The returned duration is how long to wait
// before retrying; negative means the error is permanent.
func (c *Client) attempt(ctx context.Context, body []byte, dest any) (time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return -1, fmt.Errorf("anilist: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return -1, err
		}
		return transportRetryDelay, fmt.Errorf("anilist: request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		retryAfter := 60 * time.Second
		if s := resp.Header.Get("Retry-After"); s != "" {
			if secs, err := strconv.Atoi(strings.TrimSpace(s)); err == nil && secs > 0 {
				retryAfter = time.Duration(secs) * time.Second
			}
		}
		return retryAfter, errors.New("anilist: rate limited (429)")
	case resp.StatusCode >= 500:
		return upstreamRetryDelay, fmt.Errorf("anilist: upstream %s", resp.Status)
	case resp.StatusCode != http.StatusOK:
		return -1, fmt.Errorf("anilist: unexpected status %s", resp.Status)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return 2 * time.Second, fmt.Errorf("anilist: read response: %w", err)
	}

	var env gqlEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return -1, fmt.Errorf("anilist: decode envelope: %w", err)
	}
	if len(env.Errors) > 0 {
		return -1, fmt.Errorf("anilist: graphql error: %s", env.Errors[0].Message)
	}
	if err := json.Unmarshal(env.Data, dest); err != nil {
		return -1, fmt.Errorf("anilist: decode data: %w", err)
	}
	return -1, nil
}

// SeasonPage fetches one page of a season's anime, most popular first.
func (c *Client) SeasonPage(ctx context.Context, season string, year, page, perPage int) ([]Media, bool, error) {
	var out struct {
		Page struct {
			PageInfo pageInfo `json:"pageInfo"`
			Media    []Media  `json:"media"`
		} `json:"Page"`
	}
	err := c.do(ctx, querySeasonPage, map[string]any{
		"season": season, "seasonYear": year, "page": page, "perPage": perPage,
	}, &out)
	if err != nil {
		return nil, false, err
	}
	return out.Page.Media, out.Page.PageInfo.HasNextPage, nil
}

// TrendingPage fetches one page of AniList's own trending ranking.
func (c *Client) TrendingPage(ctx context.Context, page, perPage int) ([]Media, bool, error) {
	var out struct {
		Page struct {
			PageInfo pageInfo `json:"pageInfo"`
			Media    []Media  `json:"media"`
		} `json:"Page"`
	}
	err := c.do(ctx, queryTrendingPage, map[string]any{"page": page, "perPage": perPage}, &out)
	if err != nil {
		return nil, false, err
	}
	return out.Page.Media, out.Page.PageInfo.HasNextPage, nil
}

// AiringPage fetches one page of the airing schedule between two unix times.
func (c *Client) AiringPage(ctx context.Context, from, to time.Time, page int) ([]AiringSchedule, bool, error) {
	var out struct {
		Page struct {
			PageInfo        pageInfo         `json:"pageInfo"`
			AiringSchedules []AiringSchedule `json:"airingSchedules"`
		} `json:"Page"`
	}
	err := c.do(ctx, queryAiringRange, map[string]any{
		"from": from.Unix(), "to": to.Unix(), "page": page,
	}, &out)
	if err != nil {
		return nil, false, err
	}
	return out.Page.AiringSchedules, out.Page.PageInfo.HasNextPage, nil
}

type pageInfo struct {
	HasNextPage bool `json:"hasNextPage"`
}
