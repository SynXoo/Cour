//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/time/rate"

	"cour/internal/anilist"
	"cour/internal/cache"
	"cour/internal/config"
	"cour/internal/discovery"
	"cour/internal/httpapi"
	"cour/internal/imports"
	"cour/internal/store/sqlcgen"
)

// ── helpers ────────────────────────────────────────────────────────────────

type importJobResponse struct {
	ID     int64   `json:"id"`
	Source string  `json:"source"`
	Status string  `json:"status"`
	Error  *string `json:"error"`
	Counts struct {
		Total     int `json:"total"`
		Matched   int `json:"matched"`
		Review    int `json:"review"`
		Conflicts int `json:"conflicts"`
		Applied   int `json:"applied"`
		Skipped   int `json:"skipped"`
	} `json:"counts"`
	Rows []struct {
		RowIndex int    `json:"row_index"`
		Title    string `json:"title"`
		Status   string `json:"status"`
		Score    *int   `json:"score"`
		Progress int    `json:"progress"`
		Match    string `json:"match"`
		OnList   bool   `json:"on_list"`
		Anime    *struct {
			Id int64 `json:"id"`
		} `json:"anime"`
	} `json:"rows"`
}

// uploadMAL posts a multipart MAL export.
func (c *apiClient) uploadMAL(content []byte, out any) int {
	c.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "animelist.xml")
	require.NoError(c.t, err)
	_, err = fw.Write(content)
	require.NoError(c.t, err)
	require.NoError(c.t, mw.Close())

	req, err := http.NewRequest(http.MethodPost, testServer.URL+"/api/v1/import/mal", &buf)
	require.NoError(c.t, err)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	require.NoError(c.t, err)
	defer func() { _ = resp.Body.Close() }()
	if out != nil {
		require.NoError(c.t, json.NewDecoder(resp.Body).Decode(out))
	}
	return resp.StatusCode
}

// seedBulkCatalog upserts n synthetic titles carrying MAL ids, in one batch.
func seedBulkCatalog(t *testing.T, n int, anilistBase, malBase int) map[int]int64 {
	t.Helper()
	q := sqlcgen.New(testPool)
	syncer := anilist.NewSyncer(nil, q, cache.New(testRedis), slog.New(slog.DiscardHandler))

	status := "FINISHED"
	media := make([]anilist.Media, n)
	for i := 0; i < n; i++ {
		malID := malBase + i
		media[i] = anilist.Media{
			ID:         anilistBase + i,
			IDMal:      &malID,
			Title:      anilist.Title{Romaji: fmt.Sprintf("Bulk Import Show %03d", i)},
			Status:     &status,
			Popularity: 100,
		}
	}
	ids, err := syncer.UpsertMedia(context.Background(), media)
	require.NoError(t, err)
	require.Len(t, ids, n)

	byMal := make(map[int]int64, n)
	for i := 0; i < n; i++ {
		byMal[malBase+i] = ids[anilistBase+i]
	}
	return byMal
}

// buildMALXML renders a synthetic export of n entries.
func buildMALXML(n, malBase int) []byte {
	statuses := []string{"Watching", "Completed", "Plan to Watch", "On-Hold", "Dropped"}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" ?><myanimelist><myinfo><user_name>bulk</user_name></myinfo>`)
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, `<anime>
  <series_animedb_id>%d</series_animedb_id>
  <series_title><![CDATA[Bulk Import Show %03d]]></series_title>
  <series_type>TV</series_type>
  <my_watched_episodes>%d</my_watched_episodes>
  <my_score>%d</my_score>
  <my_status>%s</my_status>
</anime>`, malBase+i, i, i%13, i%11, statuses[i%len(statuses)])
	}
	b.WriteString(`</myanimelist>`)
	return []byte(b.String())
}

func trendingIDs(t *testing.T, c *apiClient) []int64 {
	t.Helper()
	var trending struct {
		Data []struct {
			Id int64 `json:"id"`
		} `json:"data"`
	}
	status := c.do(http.MethodGet, "/api/v1/trending?limit=100", nil, &trending)
	require.Equal(t, http.StatusOK, status)
	ids := make([]int64, len(trending.Data))
	for i, a := range trending.Data {
		ids[i] = a.Id
	}
	return ids
}

func feedItems(t *testing.T, c *apiClient) []int64 {
	t.Helper()
	var feed struct {
		Data []struct {
			Id int64 `json:"id"`
		} `json:"data"`
	}
	status := c.do(http.MethodGet, "/api/v1/me/feed", nil, &feed)
	require.Equal(t, http.StatusOK, status)
	ids := make([]int64, len(feed.Data))
	for i, item := range feed.Data {
		ids[i] = item.Id
	}
	return ids
}

func activityCount(t *testing.T, userID int64) int {
	t.Helper()
	var count int
	err := testPool.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM activities WHERE user_id = $1", userID).Scan(&count)
	require.NoError(t, err)
	return count
}

func importsService(fetcher imports.ListFetcher) *imports.Service {
	return imports.New(testPool, fetcher, nil, false, slog.New(slog.DiscardHandler))
}

// ── the zero-activity regression test (docs/PHASE_2.md §M1) ────────────────

// TestMALImportZeroActivity is the spec's regression test: importing 500
// entries must leave the trending ranking unchanged and the follower feed
// silent, because the bulk apply writes no activities.
func TestMALImportZeroActivity(t *testing.T) {
	const n = 500
	ctx := context.Background()
	byMal := seedBulkCatalog(t, n, 910100, 700000)

	// A bystander generates organic activity so trending has a real ranking
	// to disturb.
	bystander := newClient(t)
	bystander.register("imp_bystander")
	hotA := byMal[700001]
	hotB := byMal[700002]
	for _, animeID := range []int64{hotA, hotB} {
		status := bystander.do(http.MethodPut, "/api/v1/me/list/"+itoa(animeID), map[string]any{
			"status": "watching", "progress": 1, "score": 8,
		}, nil)
		require.Equal(t, http.StatusOK, status)
	}
	status := bystander.do(http.MethodPut, "/api/v1/me/favorites/"+itoa(hotA), nil, nil)
	require.Equal(t, http.StatusNoContent, status)

	// The importer pre-tracks one title (this is the merge conflict), and a
	// follower watches their feed.
	importer := newClient(t)
	importerSession := importer.register("imp_importer")
	preTracked := byMal[700007]
	status = importer.do(http.MethodPut, "/api/v1/me/list/"+itoa(preTracked), map[string]any{
		"status": "watching", "progress": 2, "score": 10,
	}, nil)
	require.Equal(t, http.StatusOK, status)

	follower := newClient(t)
	follower.register("imp_follower")
	status = follower.do(http.MethodPut, "/api/v1/users/imp_importer/follow", nil, nil)
	require.Equal(t, http.StatusOK, status)

	// Baseline: trending ranking, the follower's feed, the importer's
	// activity row count.
	svc := discovery.New(testPool, cache.New(testRedis), discovery.DefaultTrendingConfig(), slog.New(slog.DiscardHandler))
	_, err := svc.RecomputeTrending(ctx)
	require.NoError(t, err)
	trendingBefore := trendingIDs(t, bystander)
	require.NotEmpty(t, trendingBefore, "baseline trending must rank something")
	feedBefore := feedItems(t, follower)
	require.NotEmpty(t, feedBefore, "the pre-track must be feed-visible — otherwise feed silence proves nothing")
	activitiesBefore := activityCount(t, importerSession.User.ID)

	// Upload → process → preview.
	var job importJobResponse
	status = importer.uploadMAL(buildMALXML(n, 700000), &job)
	require.Equal(t, http.StatusAccepted, status)
	assert.Equal(t, "pending", job.Status)
	assert.Equal(t, n, job.Counts.Total)

	require.NoError(t, importsService(nil).Process(ctx, job.ID))

	var ready importJobResponse
	status = importer.do(http.MethodGet, "/api/v1/import/jobs/"+itoa(job.ID), nil, &ready)
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, "ready", ready.Status)
	assert.Equal(t, n, ready.Counts.Matched, "every row carries a seeded mal_id")
	assert.Equal(t, 0, ready.Counts.Review)
	assert.Equal(t, 1, ready.Counts.Conflicts, "the pre-tracked title")
	require.Len(t, ready.Rows, n)
	assert.Equal(t, "id", ready.Rows[0].Match)
	require.NotNil(t, ready.Rows[0].Anime, "preview rows are hydrated")

	// Commit (merge: the pre-tracked entry survives).
	var done importJobResponse
	status = importer.do(http.MethodPost, "/api/v1/import/jobs/"+itoa(job.ID)+"/commit",
		map[string]any{"mode": "merge"}, &done)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "done", done.Status)
	assert.Equal(t, n-1, done.Counts.Applied)
	assert.Equal(t, 1, done.Counts.Skipped)

	// The list is real...
	var listCount int
	err = testPool.QueryRow(ctx,
		"SELECT COUNT(*) FROM list_entries WHERE user_id = $1", importerSession.User.ID).Scan(&listCount)
	require.NoError(t, err)
	assert.Equal(t, n, listCount)

	var entry struct {
		Status   string `json:"status"`
		Score    *int   `json:"score"`
		Progress int    `json:"progress"`
	}
	status = importer.do(http.MethodGet, "/api/v1/me/list/"+itoa(preTracked), nil, &entry)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "watching", entry.Status, "merge must not touch the existing entry")
	require.NotNil(t, entry.Score)
	assert.Equal(t, 10, *entry.Score)

	// ...and the spine is silent. THE assertions of this milestone:
	assert.Equal(t, activitiesBefore, activityCount(t, importerSession.User.ID),
		"a 500-entry import must write zero activities")

	assert.Equal(t, feedBefore, feedItems(t, follower),
		"the follower's feed must not hear about the import")

	_, err = svc.RecomputeTrending(ctx)
	require.NoError(t, err)
	assert.Equal(t, trendingBefore, trendingIDs(t, bystander),
		"importing 500 entries must leave the trending ranking unchanged")
}

// ── AniList flow: fetch, match, review resolution, supersede, overwrite ────

func TestAniListImportFlow(t *testing.T) {
	ctx := context.Background()
	alphaID := seedAnime(t, 910001, "AniList Flow Alpha", "AniList Flow Alpha", 12)
	betaID := seedAnime(t, 910002, "AniList Flow Beta", "AniList Flow Beta", 24)
	targetID := seedAnime(t, 910003, "Resolution Target", "Resolution Target", 1)

	// A stub AniList: one user's list, score format POINT_100. The custom
	// list duplicates an entry (must dedupe); the third entry is not in the
	// catalog at all (must land in review).
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"MediaListCollection":{
			"user":{"mediaListOptions":{"scoreFormat":"POINT_100"}},
			"lists":[
				{"isCustomList":false,"entries":[
					{"status":"REPEATING","score":92,"progress":3,
					 "startedAt":{"year":2024,"month":1,"day":8},"completedAt":{"year":2024,"month":3,"day":26},
					 "media":{"id":910001,"idMal":null,"title":{"romaji":"AniList Flow Alpha"},"format":"TV","seasonYear":2025,"episodes":12}},
					{"status":"CURRENT","score":0,"progress":4,
					 "startedAt":{"year":0,"month":0,"day":0},"completedAt":{"year":0,"month":0,"day":0},
					 "media":{"id":910002,"idMal":null,"title":{"romaji":"AniList Flow Beta"},"format":"TV","seasonYear":2025,"episodes":24}},
					{"status":"PLANNING","score":70,"progress":0,
					 "startedAt":{"year":0,"month":0,"day":0},"completedAt":{"year":0,"month":0,"day":0},
					 "media":{"id":999777,"idMal":null,"title":{"romaji":"Zxqv Uncatalogued Wpmfr"},"format":"TV","seasonYear":2021,"episodes":10}}
				]},
				{"isCustomList":true,"entries":[
					{"status":"REPEATING","score":92,"progress":3,
					 "media":{"id":910001,"idMal":null,"title":{"romaji":"AniList Flow Alpha"},"format":"TV","seasonYear":2025,"episodes":12}}
				]}
			]}}}`))
	}))
	defer stub.Close()

	fetcher := anilist.NewClient(slog.New(slog.DiscardHandler),
		anilist.WithURL(stub.URL), anilist.WithLimiter(rate.NewLimiter(rate.Inf, 1)))

	c := newClient(t)
	c.register("imp_anilist")

	// Pre-track Beta with different values — overwrite must flatten them.
	status := c.do(http.MethodPut, "/api/v1/me/list/"+itoa(betaID), map[string]any{
		"status": "paused", "progress": 1, "score": 3,
	}, nil)
	require.Equal(t, http.StatusOK, status)

	var job1 importJobResponse
	status = c.do(http.MethodPost, "/api/v1/import/anilist", map[string]any{"username": "sakuga_sam"}, &job1)
	require.Equal(t, http.StatusAccepted, status)

	// One live import per user: a second create while job1 is pending.
	status = c.do(http.MethodPost, "/api/v1/import/anilist", map[string]any{"username": "sakuga_sam"}, nil)
	assert.Equal(t, http.StatusConflict, status, "an active import blocks a new one")

	require.NoError(t, importsService(fetcher).Process(ctx, job1.ID))

	// A new import supersedes a job stuck at preview.
	var job2 importJobResponse
	status = c.do(http.MethodPost, "/api/v1/import/anilist", map[string]any{"username": "sakuga_sam"}, &job2)
	require.Equal(t, http.StatusAccepted, status)

	var old importJobResponse
	status = c.do(http.MethodGet, "/api/v1/import/jobs/"+itoa(job1.ID), nil, &old)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "superseded", old.Status)

	require.NoError(t, importsService(fetcher).Process(ctx, job2.ID))

	var ready importJobResponse
	status = c.do(http.MethodGet, "/api/v1/import/jobs/"+itoa(job2.ID), nil, &ready)
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, "ready", ready.Status)
	require.Len(t, ready.Rows, 3, "custom-list duplicate must dedupe")
	assert.Equal(t, 2, ready.Counts.Matched)
	assert.Equal(t, 1, ready.Counts.Review)
	assert.Equal(t, 1, ready.Counts.Conflicts)

	// The REPEATING row: completed, 92 → 9.
	alpha := ready.Rows[0]
	assert.Equal(t, "completed", alpha.Status)
	require.NotNil(t, alpha.Score)
	assert.Equal(t, 9, *alpha.Score)
	require.NotNil(t, alpha.Anime)
	assert.Equal(t, alphaID, alpha.Anime.Id)

	review := ready.Rows[2]
	assert.Equal(t, "review", review.Match)
	assert.Nil(t, review.Anime)

	// Committing an unready job is refused.
	status = c.do(http.MethodPost, "/api/v1/import/jobs/"+itoa(job1.ID)+"/commit",
		map[string]any{"mode": "merge"}, nil)
	assert.Equal(t, http.StatusConflict, status)

	// Commit overwrite, resolving the review row.
	var done importJobResponse
	status = c.do(http.MethodPost, "/api/v1/import/jobs/"+itoa(job2.ID)+"/commit", map[string]any{
		"mode": "overwrite",
		"resolutions": []map[string]any{
			{"row_index": 2, "anime_id": targetID},
		},
	}, &done)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "done", done.Status)
	assert.Equal(t, 3, done.Counts.Applied)
	assert.Equal(t, 0, done.Counts.Skipped)

	// REPEATING landed as completed with progress normalized to the count.
	var entry struct {
		Status     string  `json:"status"`
		Score      *int    `json:"score"`
		Progress   int     `json:"progress"`
		FinishedOn *string `json:"finished_on"`
	}
	status = c.do(http.MethodGet, "/api/v1/me/list/"+itoa(alphaID), nil, &entry)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "completed", entry.Status)
	assert.Equal(t, 12, entry.Progress, "mid-rewatch progress normalizes to the episode count")
	require.NotNil(t, entry.FinishedOn)
	assert.True(t, strings.HasPrefix(*entry.FinishedOn, "2024-03-26"), "source completion date survives, today is not stamped")

	// Overwrite wins on Beta — including clearing the local score, because
	// the source has none.
	status = c.do(http.MethodGet, "/api/v1/me/list/"+itoa(betaID), nil, &entry)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "watching", entry.Status)
	assert.Equal(t, 4, entry.Progress)
	assert.Nil(t, entry.Score, "overwrite means the import wins, even at unscored")

	// The resolved review row landed.
	status = c.do(http.MethodGet, "/api/v1/me/list/"+itoa(targetID), nil, &entry)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "planning", entry.Status)

	// A done job can't be committed twice.
	status = c.do(http.MethodPost, "/api/v1/import/jobs/"+itoa(job2.ID)+"/commit",
		map[string]any{"mode": "merge"}, nil)
	assert.Equal(t, http.StatusConflict, status)

	// Jobs are private.
	stranger := newClient(t)
	stranger.register("imp_stranger")
	status = stranger.do(http.MethodGet, "/api/v1/import/jobs/"+itoa(job2.ID), nil, nil)
	assert.Equal(t, http.StatusNotFound, status)
}

// TestAniListImportDemoMode: the demo stack is fully offline; the AniList
// endpoint must refuse rather than queue a job that can only fail.
func TestAniListImportDemoMode(t *testing.T) {
	cfg := config.Config{
		Env: "test", DatabaseURL: "unused", RedisAddr: "unused",
		AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour,
		WebOrigin: "http://localhost:3000", EmailMode: "log",
		DemoMode: true,
	}
	// Reuse the shared pool/redis; only the flag differs.
	handler, err := httpapi.NewRouter(httpapi.Deps{
		Cfg: cfg, Log: slog.New(slog.DiscardHandler), Pool: testPool, Redis: testRedis,
	})
	require.NoError(t, err)
	demoServer := httptest.NewServer(handler)
	defer demoServer.Close()

	// Register through the demo router so the bearer token comes from its
	// (shared) issuer... the seed is empty in tests, so issuers are
	// per-router; register here to stay consistent.
	var session sessionResponse
	body, _ := json.Marshal(map[string]any{
		"email": "imp_demo@test.local", "username": "imp_demo", "password": "integration-pw-1",
	})
	resp, err := http.Post(demoServer.URL+"/api/v1/auth/register", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&session))

	req, err := http.NewRequest(http.MethodPost, demoServer.URL+"/api/v1/import/anilist",
		strings.NewReader(`{"username":"whoever"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+session.AccessToken)
	resp2, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp2.Body.Close() }()
	assert.Equal(t, http.StatusServiceUnavailable, resp2.StatusCode)
}
