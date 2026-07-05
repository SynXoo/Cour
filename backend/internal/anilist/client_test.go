package anilist

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/time/rate"
)

// testClient spins up a stub upstream; the handler receives the 1-based call
// number so tests can fail-then-succeed.
func testClient(t *testing.T, handler func(n int32, w http.ResponseWriter, r *http.Request)) (*Client, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler(calls.Add(1), w, r)
	}))
	t.Cleanup(srv.Close)

	c := NewClient(slog.New(slog.DiscardHandler),
		WithURL(srv.URL),
		WithLimiter(rate.NewLimiter(rate.Inf, 1)),
	)
	return c, &calls
}

const seasonPageBody = `{"data":{"Page":{"pageInfo":{"hasNextPage":true},"media":[
  {"id":42,"title":{"romaji":"Test Show","english":"Test Show EN"},
   "format":"TV","status":"RELEASING","season":"SUMMER","seasonYear":2026,
   "episodes":12,"genres":["Action"],"popularity":1000,"trending":5,
   "coverImage":{"extraLarge":"https://img/c.jpg","color":"#abc123"},
   "nextAiringEpisode":{"airingAt":1780000000,"episode":3}}
]}}}`

func TestSeasonPageParses(t *testing.T) {
	c, calls := testClient(t, func(_ int32, w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(seasonPageBody))
	})

	media, hasNext, err := c.SeasonPage(t.Context(), "SUMMER", 2026, 1, 50)
	require.NoError(t, err)
	assert.True(t, hasNext)
	assert.EqualValues(t, 1, calls.Load())
	require.Len(t, media, 1)

	m := media[0]
	assert.Equal(t, 42, m.ID)
	assert.Equal(t, "Test Show", m.Title.Romaji)
	assert.Equal(t, "RELEASING", *m.Status)
	assert.Equal(t, 12, *m.Episodes)
	assert.Equal(t, 3, m.NextAiring.Episode)
}

func TestRateLimit429HonorsRetryAfter(t *testing.T) {
	start := time.Now()
	c, calls := testClient(t, func(n int32, w http.ResponseWriter, _ *http.Request) {
		if n == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(seasonPageBody))
	})

	_, _, err := c.SeasonPage(t.Context(), "SUMMER", 2026, 1, 50)
	require.NoError(t, err)
	assert.EqualValues(t, 2, calls.Load())
	assert.GreaterOrEqual(t, time.Since(start), time.Second, "must wait out Retry-After")
}

func TestUpstream5xxRetried(t *testing.T) {
	old := upstreamRetryDelay
	upstreamRetryDelay = 10 * time.Millisecond
	t.Cleanup(func() { upstreamRetryDelay = old })

	c, calls := testClient(t, func(n int32, w http.ResponseWriter, _ *http.Request) {
		if n < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = w.Write([]byte(seasonPageBody))
	})

	_, _, err := c.SeasonPage(t.Context(), "SUMMER", 2026, 1, 50)
	require.NoError(t, err)
	assert.EqualValues(t, 3, calls.Load())
}

func TestGraphQLErrorNotRetried(t *testing.T) {
	c, calls := testClient(t, func(_ int32, w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":null,"errors":[{"message":"Invalid season"}]}`))
	})

	_, _, err := c.SeasonPage(t.Context(), "BADSEASON", 2026, 1, 50)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Invalid season")
	assert.EqualValues(t, 1, calls.Load(), "semantic errors must not be retried")
}
