//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/notify"
	"cour/internal/store/sqlcgen"
)

type relation struct {
	Followers   int    `json:"followers"`
	Following   int    `json:"following"`
	Friends     int    `json:"friends"`
	IsFollowing bool   `json:"is_following"`
	Friendship  string `json:"friendship"`
}

type userRef struct {
	Username string `json:"username"`
}

// pendingNotifyTasks reads the API's enqueued notification tasks straight
// out of Redis (no worker runs in the suite), so a test can assert the
// enqueue happened and then run the worker handler on the real payload.
func pendingNotifyTasks(t *testing.T, taskType string) []*asynq.TaskInfo {
	t.Helper()
	insp := asynq.NewInspector(asynq.RedisClientOpt{Addr: testRedis.Options().Addr})
	defer func() { _ = insp.Close() }()
	tasks, err := insp.ListPendingTasks("critical", asynq.PageSize(500))
	require.NoError(t, err)
	var out []*asynq.TaskInfo
	for _, task := range tasks {
		if task.Type == taskType {
			out = append(out, task)
		}
	}
	return out
}

func notifyMux() *asynq.ServeMux {
	mux := asynq.NewServeMux()
	notify.NewHandlers(sqlcgen.New(testPool), testRedis, slog.New(slog.DiscardHandler)).Register(mux)
	return mux
}

func latestNotification(t *testing.T, c *apiClient) (kind string, actor string, payload map[string]any) {
	t.Helper()
	var res struct {
		Data []struct {
			Type    string         `json:"type"`
			Actor   *userRef       `json:"actor"`
			Payload map[string]any `json:"payload"`
		} `json:"data"`
	}
	status := c.do(http.MethodGet, "/api/v1/me/notifications", nil, &res)
	require.Equal(t, http.StatusOK, status)
	require.NotEmpty(t, res.Data)
	n := res.Data[0]
	if n.Actor != nil {
		actor = n.Actor.Username
	}
	return n.Type, actor, n.Payload
}

// TestFriendsFlow walks the whole M3.9 surface over real HTTP: request →
// notification → accept-by-mutual-PUT (auto-follow both ways) → friends on
// a show → recommend (friends only) → direct messages (friends only, read
// pointers) → friends-scoped feed → search → unfriend keeps the follows.
func TestFriendsFlow(t *testing.T) {
	animeID := seedAnime(t, 900010, "Friends Test Show", "Friends Test Show", 12)

	ann := newClient(t)
	annSession := ann.register("ann_fr")
	ben := newClient(t)
	benSession := ben.register("ben_fr")
	cal := newClient(t)
	cal.register("cal_fr")

	// ── Request with a note ────────────────────────────────────────────
	var rel relation
	status := ann.do(http.MethodPut, "/api/v1/users/ben_fr/friend", map[string]any{"note": "same Frieren thread"}, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "request_sent", rel.Friendship)
	assert.Equal(t, 0, rel.Friends)

	status = ben.do(http.MethodGet, "/api/v1/users/ann_fr/follow", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "request_received", rel.Friendship)

	// Anonymous callers see counts and `none`.
	anon := newClient(t)
	status = anon.do(http.MethodGet, "/api/v1/users/ann_fr/follow", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "none", rel.Friendship)

	// Self is `self`, and befriending yourself is a 400.
	status = ann.do(http.MethodGet, "/api/v1/users/ann_fr/follow", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "self", rel.Friendship)
	status = ann.do(http.MethodPut, "/api/v1/users/ann_fr/friend", nil, nil)
	assert.Equal(t, http.StatusBadRequest, status)

	var overview struct {
		Friends  []userRef `json:"friends"`
		Incoming []struct {
			User userRef `json:"user"`
			Note string  `json:"note"`
		} `json:"incoming"`
		Outgoing []struct {
			User userRef `json:"user"`
		} `json:"outgoing"`
		Suggested []userRef `json:"suggested"`
	}
	status = ben.do(http.MethodGet, "/api/v1/me/friends", nil, &overview)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, overview.Incoming, 1)
	assert.Equal(t, "ann_fr", overview.Incoming[0].User.Username)
	assert.Equal(t, "same Frieren thread", overview.Incoming[0].Note)
	status = ann.do(http.MethodGet, "/api/v1/me/friends", nil, &overview)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, overview.Outgoing, 1)
	assert.Equal(t, "ben_fr", overview.Outgoing[0].User.Username)

	// The request enqueued a notification task; run it like the worker would.
	mux := notifyMux()
	tasks := pendingNotifyTasks(t, notify.TaskFriendRequest)
	require.NotEmpty(t, tasks, "friend request must enqueue a notification")
	for _, task := range tasks {
		require.NoError(t, mux.ProcessTask(context.Background(), asynq.NewTask(task.Type, task.Payload)))
	}
	kind, actor, payload := latestNotification(t, ben)
	assert.Equal(t, "friend_request", kind)
	assert.Equal(t, "ann_fr", actor)
	assert.Equal(t, "same Frieren thread", payload["note"])

	// ── Accept by mutual intent: Ben PUTs back ─────────────────────────
	status = ben.do(http.MethodPut, "/api/v1/users/ann_fr/friend", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "friends", rel.Friendship)
	assert.Equal(t, 1, rel.Friends)
	assert.True(t, rel.IsFollowing, "accepting auto-follows")
	status = ann.do(http.MethodGet, "/api/v1/users/ben_fr/follow", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.True(t, rel.IsFollowing, "…both ways")
	assert.Equal(t, "friends", rel.Friendship)

	// Pending row is gone; the overview lists the friend.
	status = ann.do(http.MethodGet, "/api/v1/me/friends", nil, &overview)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, overview.Outgoing)
	require.Len(t, overview.Friends, 1)
	assert.Equal(t, "ben_fr", overview.Friends[0].Username)

	for _, task := range pendingNotifyTasks(t, notify.TaskFriendAccepted) {
		require.NoError(t, mux.ProcessTask(context.Background(), asynq.NewTask(task.Type, task.Payload)))
	}
	kind, actor, _ = latestNotification(t, ann)
	assert.Equal(t, "friend_accepted", kind)
	assert.Equal(t, "ben_fr", actor)

	// Public friends list on the profile.
	var refs struct {
		Data []userRef `json:"data"`
	}
	status = anon.do(http.MethodGet, "/api/v1/users/ann_fr/friends", nil, &refs)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, refs.Data, 1)
	assert.Equal(t, "ben_fr", refs.Data[0].Username)

	// ── Friends on this show ───────────────────────────────────────────
	status = ben.do(http.MethodPut, "/api/v1/me/list/"+itoa(animeID), map[string]any{
		"status": "watching", "progress": 5,
	}, nil)
	require.Equal(t, http.StatusOK, status)

	var onShow struct {
		Data []struct {
			User     userRef `json:"user"`
			Status   string  `json:"status"`
			Progress int     `json:"progress"`
		} `json:"data"`
		Recommendations []struct {
			From userRef `json:"from"`
			Note string  `json:"note"`
		} `json:"recommendations"`
	}
	status = ann.do(http.MethodGet, "/api/v1/anime/"+itoa(animeID)+"/friends", nil, &onShow)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, onShow.Data, 1)
	assert.Equal(t, "ben_fr", onShow.Data[0].User.Username)
	assert.Equal(t, "watching", onShow.Data[0].Status)
	assert.Equal(t, 5, onShow.Data[0].Progress)
	assert.Empty(t, onShow.Recommendations)

	// ── Recommend: friends only ────────────────────────────────────────
	status = cal.do(http.MethodPost, "/api/v1/anime/"+itoa(animeID)+"/recommend", map[string]any{"to": "ben_fr", "note": "trust me"}, nil)
	assert.Equal(t, http.StatusForbidden, status, "strangers can't recommend")
	status = ann.do(http.MethodPost, "/api/v1/anime/"+itoa(animeID)+"/recommend", map[string]any{"to": "ben_fr", "note": "the sakuga in ep 7"}, nil)
	require.Equal(t, http.StatusNoContent, status)
	// Re-recommending updates the note instead of duplicating.
	status = ann.do(http.MethodPost, "/api/v1/anime/"+itoa(animeID)+"/recommend", map[string]any{"to": "ben_fr", "note": "the sakuga in ep 8"}, nil)
	require.Equal(t, http.StatusNoContent, status)

	status = ben.do(http.MethodGet, "/api/v1/anime/"+itoa(animeID)+"/friends", nil, &onShow)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, onShow.Recommendations, 1)
	assert.Equal(t, "ann_fr", onShow.Recommendations[0].From.Username)
	assert.Equal(t, "the sakuga in ep 8", onShow.Recommendations[0].Note)

	for _, task := range pendingNotifyTasks(t, notify.TaskRecommendation) {
		require.NoError(t, mux.ProcessTask(context.Background(), asynq.NewTask(task.Type, task.Payload)))
	}
	kind, actor, payload = latestNotification(t, ben)
	assert.Equal(t, "recommendation", kind)
	assert.Equal(t, "ann_fr", actor)
	assert.Equal(t, "the sakuga in ep 8", payload["note"])

	// Ben already has the show on his list, so the home row stays empty for
	// him; Ann has nothing recommended.
	var recs struct {
		Data []struct {
			Anime struct {
				ID int64 `json:"id"`
			} `json:"anime"`
		} `json:"data"`
	}
	status = ben.do(http.MethodGet, "/api/v1/me/friend-recommendations", nil, &recs)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, recs.Data, "on-list shows never appear in the row")
	status = ben.do(http.MethodDelete, "/api/v1/me/list/"+itoa(animeID), nil, nil)
	require.Equal(t, http.StatusNoContent, status)
	status = ben.do(http.MethodGet, "/api/v1/me/friend-recommendations", nil, &recs)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, recs.Data, 1)
	assert.Equal(t, animeID, recs.Data[0].Anime.ID)

	// ── Direct messages ────────────────────────────────────────────────
	status = cal.do(http.MethodPost, "/api/v1/me/messages/ben_fr", map[string]any{"body": "hi stranger"}, nil)
	assert.Equal(t, http.StatusForbidden, status, "DMs are friends only")
	status = ann.do(http.MethodPost, "/api/v1/me/messages/ben_fr", map[string]any{"body": "   "}, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, status)

	var sent struct {
		ID     int64  `json:"id"`
		Mine   bool   `json:"mine"`
		Sender string `json:"sender"`
	}
	status = ann.do(http.MethodPost, "/api/v1/me/messages/ben_fr", map[string]any{"body": "did you see ep 7?"}, &sent)
	require.Equal(t, http.StatusCreated, status)
	assert.True(t, sent.Mine)
	assert.Equal(t, "ann_fr", sent.Sender)

	var count struct {
		Count int `json:"count"`
	}
	status = ben.do(http.MethodGet, "/api/v1/me/messages/unread-count", nil, &count)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, 1, count.Count)
	status = ann.do(http.MethodGet, "/api/v1/me/messages/unread-count", nil, &count)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, 0, count.Count, "your own message is never unread for you")

	var inbox struct {
		Data []struct {
			Peer     userRef `json:"peer"`
			LastBody string  `json:"last_body"`
			LastMine bool    `json:"last_mine"`
			Unread   int     `json:"unread"`
		} `json:"data"`
	}
	status = ben.do(http.MethodGet, "/api/v1/me/messages", nil, &inbox)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, inbox.Data, 1)
	assert.Equal(t, "ann_fr", inbox.Data[0].Peer.Username)
	assert.Equal(t, "did you see ep 7?", inbox.Data[0].LastBody)
	assert.False(t, inbox.Data[0].LastMine)
	assert.Equal(t, 1, inbox.Data[0].Unread)

	var page struct {
		Data []struct {
			Mine   bool   `json:"mine"`
			Sender string `json:"sender"`
			Body   string `json:"body"`
		} `json:"data"`
		NextCursor *int64 `json:"next_cursor"`
	}
	status = ben.do(http.MethodGet, "/api/v1/me/messages/ann_fr", nil, &page)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, page.Data, 1)
	assert.False(t, page.Data[0].Mine)
	assert.Equal(t, "ann_fr", page.Data[0].Sender)
	assert.Nil(t, page.NextCursor)

	status = ben.do(http.MethodPost, "/api/v1/me/messages/ann_fr/read", nil, nil)
	require.Equal(t, http.StatusNoContent, status)
	status = ben.do(http.MethodGet, "/api/v1/me/messages/unread-count", nil, &count)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, 0, count.Count)

	status = ben.do(http.MethodPost, "/api/v1/me/messages/ann_fr", map[string]any{"body": "twice."}, nil)
	require.Equal(t, http.StatusCreated, status)
	status = ann.do(http.MethodGet, "/api/v1/me/messages/ben_fr", nil, &page)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, page.Data, 2)
	assert.Equal(t, "twice.", page.Data[0].Body, "newest first")
	assert.True(t, page.Data[1].Mine)

	// A conversation with a friend you've never messaged is an empty page,
	// not an error; with a stranger it's empty too (the UI explains).
	status = cal.do(http.MethodGet, "/api/v1/me/messages/ann_fr", nil, &page)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, page.Data)

	// ── Friends-scoped feed ────────────────────────────────────────────
	// Cal (a stranger Ann follows) and Ben (a friend) both add the show;
	// only Ben's activity is in the friends scope, both in the default one.
	status = ann.do(http.MethodPut, "/api/v1/users/cal_fr/follow", nil, nil)
	require.Equal(t, http.StatusOK, status)
	status = cal.do(http.MethodPut, "/api/v1/me/list/"+itoa(animeID), map[string]any{"status": "planning"}, nil)
	require.Equal(t, http.StatusOK, status)
	status = ben.do(http.MethodPut, "/api/v1/me/list/"+itoa(animeID), map[string]any{"status": "watching"}, nil)
	require.Equal(t, http.StatusOK, status)

	var feed struct {
		Data []struct {
			Actor userRef `json:"actor"`
		} `json:"data"`
	}
	status = ann.do(http.MethodGet, "/api/v1/me/feed?scope=friends", nil, &feed)
	require.Equal(t, http.StatusOK, status)
	require.NotEmpty(t, feed.Data)
	for _, item := range feed.Data {
		assert.Equal(t, "ben_fr", item.Actor.Username, "friends scope carries friends only")
	}
	status = ann.do(http.MethodGet, "/api/v1/me/feed", nil, &feed)
	require.Equal(t, http.StatusOK, status)
	actors := map[string]bool{}
	for _, item := range feed.Data {
		actors[item.Actor.Username] = true
	}
	assert.True(t, actors["cal_fr"] && actors["ben_fr"], "default scope is everyone followed")

	// ── Find people ────────────────────────────────────────────────────
	status = anon.do(http.MethodGet, "/api/v1/users?q=ben_f", nil, &refs)
	require.Equal(t, http.StatusOK, status)
	found := false
	for _, r := range refs.Data {
		found = found || r.Username == "ben_fr"
	}
	assert.True(t, found)

	// ── Unfriend keeps the follows ─────────────────────────────────────
	status = ann.do(http.MethodDelete, "/api/v1/users/ben_fr/friend", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "none", rel.Friendship)
	assert.Equal(t, 0, rel.Friends)
	assert.True(t, rel.IsFollowing, "unfriending never touches follows")
	status = ann.do(http.MethodPost, "/api/v1/me/messages/ben_fr", map[string]any{"body": "still there?"}, nil)
	assert.Equal(t, http.StatusForbidden, status, "the DM gate closes with the friendship")

	// DELETE also declines an incoming request.
	status = cal.do(http.MethodPut, "/api/v1/users/ann_fr/friend", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "request_sent", rel.Friendship)
	status = ann.do(http.MethodDelete, "/api/v1/users/cal_fr/friend", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "none", rel.Friendship)
	status = cal.do(http.MethodGet, "/api/v1/users/ann_fr/follow", nil, &rel)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "none", rel.Friendship, "declined = gone on both sides")

	_ = annSession
	_ = benSession
}

// TestMentionNotification: a comment naming @users enqueues one mention
// task with the resolved ids (author and parent author excluded), and the
// worker handler turns it into per-user notifications.
func TestMentionNotification(t *testing.T) {
	animeID := seedAnime(t, 900011, "Mention Test Show", "Mention Test Show", 12)

	dee := newClient(t)
	deeSession := dee.register("dee_mn")
	eli := newClient(t)
	eliSession := eli.register("eli_mn")
	fay := newClient(t)
	fay.register("fay_mn")

	var thread struct {
		Thread struct {
			Id int64 `json:"id"`
		} `json:"thread"`
	}
	status := dee.do(http.MethodGet, "/api/v1/anime/"+itoa(animeID)+"/episodes/1/thread", nil, &thread)
	require.Equal(t, http.StatusOK, status)

	var top struct {
		Id int64 `json:"id"`
	}
	status = dee.do(http.MethodPost, "/api/v1/threads/"+itoa(thread.Thread.Id)+"/comments", map[string]any{
		"body": "that cut though",
	}, &top)
	require.Equal(t, http.StatusCreated, status)

	// Fay replies to Dee and mentions Dee (reply covers it), Eli (pinged),
	// herself (never), and a ghost (ignored).
	var reply struct {
		Id int64 `json:"id"`
	}
	status = fay.do(http.MethodPost, "/api/v1/threads/"+itoa(thread.Thread.Id)+"/comments", map[string]any{
		"body": "@dee_mn @Eli_MN @fay_mn @nobody_here agreed, the sakuga!", "parent_id": top.Id,
	}, &reply)
	require.Equal(t, http.StatusCreated, status)

	var mentionTask *asynq.TaskInfo
	for _, task := range pendingNotifyTasks(t, notify.TaskMention) {
		var p struct {
			CommentID int64   `json:"comment_id"`
			UserIDs   []int64 `json:"user_ids"`
		}
		require.NoError(t, json.Unmarshal(task.Payload, &p))
		if p.CommentID == reply.Id {
			mentionTask = task
			assert.Equal(t, []int64{eliSession.User.ID}, p.UserIDs,
				"only Eli: the author and the parent's author are excluded, ghosts don't resolve")
		}
	}
	require.NotNil(t, mentionTask, "a mentioning comment enqueues one mention task")

	mux := notifyMux()
	require.NoError(t, mux.ProcessTask(context.Background(), asynq.NewTask(mentionTask.Type, mentionTask.Payload)))

	kind, actor, payload := latestNotification(t, eli)
	assert.Equal(t, "mention", kind)
	assert.Equal(t, "fay_mn", actor)
	assert.Equal(t, "episode", payload["kind"])
	assert.Equal(t, float64(1), payload["episode"])

	_ = deeSession
}
