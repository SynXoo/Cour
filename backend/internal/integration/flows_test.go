//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/anilist"
	"cour/internal/cache"
	"cour/internal/discovery"
	"cour/internal/notify"
	"cour/internal/store/sqlcgen"
)

// seedAnime upserts a synthetic title through the same path the AniList sync
// uses and returns its internal id.
func seedAnime(t *testing.T, anilistID int, romaji, english string, episodes int) int64 {
	t.Helper()
	q := sqlcgen.New(testPool)
	syncer := anilist.NewSyncer(nil, q, cache.New(testRedis), slog.New(slog.DiscardHandler))

	status := "RELEASING"
	season := "SUMMER"
	year := time.Now().Year()
	ids, err := syncer.UpsertMedia(context.Background(), []anilist.Media{{
		ID:         anilistID,
		Title:      anilist.Title{Romaji: romaji, English: &english},
		Status:     &status,
		Season:     &season,
		SeasonYear: &year,
		Episodes:   &episodes,
		Genres:     []string{"Action"},
		Popularity: 1000,
	}})
	require.NoError(t, err)
	return ids[anilistID]
}

func TestAuthLifecycle(t *testing.T) {
	c := newClient(t)
	c.register("authuser")

	// Bearer works.
	var me struct {
		Username string `json:"username"`
	}
	status := c.do(http.MethodGet, "/api/v1/auth/me", nil, &me)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "authuser", me.Username)

	// Refresh rotates: keep the pre-rotation cookie for the replay attack.
	serverURL := mustParseURL(t, testServer.URL)
	stolen := append([]*http.Cookie{}, c.http.Jar.Cookies(serverURL)...)

	var refreshed sessionResponse
	status = c.do(http.MethodPost, "/api/v1/auth/refresh", nil, &refreshed)
	require.Equal(t, http.StatusOK, status)
	require.NotEmpty(t, refreshed.AccessToken)

	// Replaying the rotated (stolen) cookie must fail AND kill the family.
	thief := newClient(t)
	thief.http.Jar.SetCookies(serverURL, stolen)
	status = thief.do(http.MethodPost, "/api/v1/auth/refresh", nil, nil)
	assert.Equal(t, http.StatusUnauthorized, status, "rotated token replay must 401")

	// The legitimate holder's (post-rotation) session died with the family.
	status = c.do(http.MethodPost, "/api/v1/auth/refresh", nil, nil)
	assert.Equal(t, http.StatusUnauthorized, status, "family must be revoked after reuse")

	// Wrong password.
	status = c.do(http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": "authuser@test.local", "password": "wrong-password",
	}, nil)
	assert.Equal(t, http.StatusUnauthorized, status)

	// Right password recovers.
	var again sessionResponse
	status = c.do(http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": "authuser@test.local", "password": "integration-pw-1",
	}, &again)
	require.Equal(t, http.StatusOK, status)
	assert.NotEmpty(t, again.AccessToken)
}

func TestListFlowRecordsActivities(t *testing.T) {
	animeID := seedAnime(t, 900001, "Integration Test Show", "Integration Test Show", 12)

	c := newClient(t)
	session := c.register("listuser")

	// Add as watching with progress.
	var entry struct {
		Status   string `json:"status"`
		Progress int    `json:"progress"`
	}
	status := c.do(http.MethodPut, "/api/v1/me/list/"+itoa(animeID), map[string]any{
		"status": "watching", "progress": 3, "score": 8,
	}, &entry)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "watching", entry.Status)
	assert.Equal(t, 3, entry.Progress)

	// Final episode auto-completes.
	status = c.do(http.MethodPut, "/api/v1/me/list/"+itoa(animeID), map[string]any{
		"status": "watching", "progress": 12,
	}, &entry)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "completed", entry.Status)
	assert.Equal(t, 12, entry.Progress)

	// The transaction wrote activities (list_add + scored at minimum).
	var count int
	err := testPool.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM activities WHERE user_id = $1 AND anime_id = $2",
		session.User.ID, animeID).Scan(&count)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, count, 3, "list_add + scored + completed")
}

func TestSearchSurvivesTypos(t *testing.T) {
	seedAnime(t, 900002, "Sousou no Frieren", "Frieren: Beyond Journey's End", 28)

	c := newClient(t)
	var result struct {
		Data []struct {
			Title string `json:"title"`
		} `json:"data"`
	}
	status := c.do(http.MethodGet, "/api/v1/anime?q=friren", nil, &result) // typo intended
	require.Equal(t, http.StatusOK, status)
	require.NotEmpty(t, result.Data, "trigram search must rescue the typo")
	assert.Equal(t, "Sousou no Frieren", result.Data[0].Title)
}

func TestTrendingPipeline(t *testing.T) {
	hotID := seedAnime(t, 900003, "Hot This Week", "Hot This Week", 12)
	coldID := seedAnime(t, 900004, "Stale Classic", "Stale Classic", 12)

	// Hot: many recent events. Cold: more events, but two weeks stale would
	// be outside the window — use old-but-in-window to exercise decay.
	q := sqlcgen.New(testPool)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		require.NoError(t, q.InsertActivity(ctx, sqlcgen.InsertActivityParams{
			UserID: 1, Type: sqlcgen.ActivityTypeFavorite, AnimeID: &hotID, Payload: []byte("{}"),
		}))
	}
	for i := 0; i < 8; i++ {
		require.NoError(t, q.InsertActivity(ctx, sqlcgen.InsertActivityParams{
			UserID: 1, Type: sqlcgen.ActivityTypeFavorite, AnimeID: &coldID, Payload: []byte("{}"),
		}))
	}
	// Age the cold title's events by 10 days.
	_, err := testPool.Exec(ctx,
		"UPDATE activities SET created_at = now() - interval '10 days' WHERE anime_id = $1", coldID)
	require.NoError(t, err)

	svc := discovery.New(testPool, cache.New(testRedis), discovery.DefaultTrendingConfig(), slog.New(slog.DiscardHandler))
	_, err = svc.RecomputeTrending(ctx)
	require.NoError(t, err)

	c := newClient(t)
	var trending struct {
		Data []struct {
			Id int64 `json:"id"`
		} `json:"data"`
	}
	status := c.do(http.MethodGet, "/api/v1/trending?limit=50", nil, &trending)
	require.Equal(t, http.StatusOK, status)

	hotRank, coldRank := -1, -1
	for i, a := range trending.Data {
		if a.Id == hotID {
			hotRank = i
		}
		if a.Id == coldID {
			coldRank = i
		}
	}
	require.NotEqual(t, -1, hotRank, "hot title must rank")
	require.NotEqual(t, -1, coldRank, "cold title still in window, must rank")
	assert.Less(t, hotRank, coldRank, "5 fresh favorites must outrank 8 ten-day-old ones")
}

func TestEpisodeThreadReplyNotification(t *testing.T) {
	animeID := seedAnime(t, 900005, "Thread Test Show", "Thread Test Show", 12)

	alice := newClient(t)
	aliceSession := alice.register("alice_int")
	bob := newClient(t)
	bob.register("bob_int")

	// Alice opens (creates) the episode-1 thread and posts with a timestamp.
	var thread struct {
		Thread struct {
			Id int64 `json:"id"`
		} `json:"thread"`
	}
	status := alice.do(http.MethodGet, "/api/v1/anime/"+itoa(animeID)+"/episodes/1/thread", nil, &thread)
	require.Equal(t, http.StatusOK, status)

	var comment struct {
		Id               int64 `json:"id"`
		TimestampSeconds *int  `json:"timestamp_seconds"`
	}
	status = alice.do(http.MethodPost, "/api/v1/threads/"+itoa(thread.Thread.Id)+"/comments", map[string]any{
		"body": "that cut at 12:34 was unreal", "timestamp_seconds": 754,
	}, &comment)
	require.Equal(t, http.StatusCreated, status)
	require.NotNil(t, comment.TimestampSeconds)
	assert.Equal(t, 754, *comment.TimestampSeconds)

	// Bob replies.
	var reply struct {
		Id int64 `json:"id"`
	}
	status = bob.do(http.MethodPost, "/api/v1/threads/"+itoa(thread.Thread.Id)+"/comments", map[string]any{
		"body": "same, rewound it twice", "parent_id": comment.Id,
	}, &reply)
	require.Equal(t, http.StatusCreated, status)

	// Run the notification handler the worker would run.
	mux := asynq.NewServeMux()
	notify.NewHandlers(sqlcgen.New(testPool), testRedis, slog.New(slog.DiscardHandler)).Register(mux)
	payload, _ := json.Marshal(map[string]any{"comment_id": reply.Id})
	require.NoError(t, mux.ProcessTask(context.Background(),
		asynq.NewTask(notify.TaskCommentReply, payload)))

	// Alice sees the notification.
	var notifications struct {
		Data []struct {
			Type string `json:"type"`
		} `json:"data"`
	}
	status = alice.do(http.MethodGet, "/api/v1/me/notifications", nil, &notifications)
	require.Equal(t, http.StatusOK, status)
	require.NotEmpty(t, notifications.Data)
	assert.Equal(t, "comment_reply", notifications.Data[0].Type)

	_ = aliceSession
}
