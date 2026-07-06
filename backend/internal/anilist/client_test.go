package anilist

import (
	"encoding/json"
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

const catalogPageBody = `{"data":{"Page":{"pageInfo":{"hasNextPage":true},"media":[
  {"id":100,"title":{"romaji":"Old Classic"},"format":"TV","status":"FINISHED",
   "episodes":26,"genres":["Drama"],"popularity":50000},
  {"id":140,"title":{"romaji":"Old Movie"},"format":"MOVIE","status":"FINISHED",
   "episodes":1,"genres":["Action"],"popularity":30000}
]}}}`

func TestCatalogPageDateWindow(t *testing.T) {
	var got gqlRequest
	c, _ := testClient(t, func(_ int32, w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(catalogPageBody))
	})

	win := catalogWindow{dateGreater: 19999999, dateLesser: 20010000, label: "2000"}
	media, hasNext, err := c.CatalogPage(t.Context(), win, 3, 50)
	require.NoError(t, err)
	assert.True(t, hasNext)
	require.Len(t, media, 2)
	assert.Equal(t, 100, media[0].ID)

	assert.EqualValues(t, 3, got.Variables["page"])
	assert.EqualValues(t, 19999999, got.Variables["dateGreater"])
	assert.EqualValues(t, 20010000, got.Variables["dateLesser"])
	assert.NotContains(t, got.Variables, "status",
		"an omitted variable must not be sent — null filters differ from absent ones")
}

func TestCatalogPageStatusWindow(t *testing.T) {
	var got gqlRequest
	c, _ := testClient(t, func(_ int32, w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(catalogPageBody))
	})

	win := catalogWindow{status: "NOT_YET_RELEASED", label: "not_yet_released"}
	_, _, err := c.CatalogPage(t.Context(), win, 1, 50)
	require.NoError(t, err)

	assert.EqualValues(t, "NOT_YET_RELEASED", got.Variables["status"])
	assert.NotContains(t, got.Variables, "dateGreater")
	assert.NotContains(t, got.Variables, "dateLesser")
}

func TestCatalogWindowsCoverEverySeam(t *testing.T) {
	now := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	ws := catalogWindows(now)

	require.Greater(t, len(ws), 50)
	assert.Equal(t, "NOT_YET_RELEASED", ws[0].status)
	assert.Equal(t, "CANCELLED", ws[1].status)
	assert.Equal(t, "2028", ws[len(ws)-1].label, "must reach two years ahead for announcements")

	// Exclusive bounds must tile with no gap: a title dated exactly Jan 1st
	// of a boundary year belongs to exactly one window.
	for i := 3; i < len(ws); i++ {
		assert.Equal(t, ws[i-1].dateLesser, ws[i].dateGreater+1,
			"gap between %s and %s", ws[i-1].label, ws[i].label)
	}
}

func TestUpdatedPageParsesEditTimes(t *testing.T) {
	var got gqlRequest
	c, _ := testClient(t, func(_ int32, w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"Page":{"pageInfo":{"hasNextPage":false},"media":[
			{"id":7,"title":{"romaji":"Edited Show"},"genres":[],"popularity":1,"updatedAt":1780000123}
		]}}}`))
	})

	media, hasNext, err := c.UpdatedPage(t.Context(), 2, 50)
	require.NoError(t, err)
	assert.False(t, hasNext)
	require.Len(t, media, 1)
	require.NotNil(t, media[0].UpdatedAt)
	assert.EqualValues(t, 1780000123, *media[0].UpdatedAt)

	assert.EqualValues(t, 2, got.Variables["page"])
	assert.Contains(t, got.Query, "sort: UPDATED_AT_DESC")
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
