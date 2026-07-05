// Package notify is the notification subsystem: API-side enqueuers (thin
// asynq producers called after user actions) and worker-side handlers that
// materialize notification rows. Delivery is async by design — user actions
// never block on fan-out, and Phase 2 swaps the poll-read for a push over
// Redis pub/sub without touching producers.
package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"cour/internal/store/sqlcgen"
)

const (
	TaskCommentReply  = "notify:comment_reply"
	TaskNewFollower   = "notify:new_follower"
	TaskEpisodesAired = "notify:episodes_aired"

	queue = "critical"
)

type commentReplyPayload struct {
	CommentID int64 `json:"comment_id"`
}

type newFollowerPayload struct {
	FollowerID int64 `json:"follower_id"`
	FolloweeID int64 `json:"followee_id"`
}

// ── Producer (used by the API process) ─────────────────────────────────────

type Enqueuer struct {
	client *asynq.Client
	log    *slog.Logger
}

func NewEnqueuer(redisAddr string, log *slog.Logger) *Enqueuer {
	return &Enqueuer{
		client: asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr}),
		log:    log,
	}
}

func (e *Enqueuer) Close() error { return e.client.Close() }

func (e *Enqueuer) enqueue(taskType string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		e.log.Error("notify: marshal payload", "task", taskType, "err", err)
		return
	}
	if _, err := e.client.Enqueue(asynq.NewTask(taskType, raw), asynq.Queue(queue)); err != nil {
		// Notifications are best-effort; never fail the user action.
		e.log.Error("notify: enqueue failed", "task", taskType, "err", err)
	}
}

// CommentPosted implements discussions.Notifier.
func (e *Enqueuer) CommentPosted(_ context.Context, comment sqlcgen.Comment, _ sqlcgen.Thread) {
	if comment.ParentID == nil {
		return // top-level comments notify nobody
	}
	e.enqueue(TaskCommentReply, commentReplyPayload{CommentID: comment.ID})
}

// Followed fans out a new-follower notification.
func (e *Enqueuer) Followed(_ context.Context, followerID, followeeID int64) {
	e.enqueue(TaskNewFollower, newFollowerPayload{FollowerID: followerID, FolloweeID: followeeID})
}

// ── Consumer (worker process) ──────────────────────────────────────────────

type Handlers struct {
	q   *sqlcgen.Queries
	rdb *redis.Client
	log *slog.Logger
}

func NewHandlers(q *sqlcgen.Queries, rdb *redis.Client, log *slog.Logger) *Handlers {
	return &Handlers{q: q, rdb: rdb, log: log}
}

func (h *Handlers) Register(mux *asynq.ServeMux) {
	mux.HandleFunc(TaskCommentReply, h.handleCommentReply)
	mux.HandleFunc(TaskNewFollower, h.handleNewFollower)
	mux.HandleFunc(TaskEpisodesAired, h.handleEpisodesAired)
}

func (h *Handlers) handleCommentReply(ctx context.Context, t *asynq.Task) error {
	var p commentReplyPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode: %w", err)
	}

	comment, err := h.q.GetComment(ctx, p.CommentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // deleted before we ran; nothing to do
		}
		return fmt.Errorf("get comment: %w", err)
	}
	if comment.ParentID == nil {
		return nil
	}
	parent, err := h.q.GetComment(ctx, *comment.ParentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("get parent: %w", err)
	}
	if parent.UserID == comment.UserID {
		return nil // self-replies don't ping
	}

	thread, err := h.q.GetThread(ctx, comment.ThreadID)
	if err != nil {
		return fmt.Errorf("get thread: %w", err)
	}
	payload, err := threadLinkPayload(ctx, h.q, thread)
	if err != nil {
		return err
	}

	if err := h.q.InsertNotification(ctx, sqlcgen.InsertNotificationParams{
		UserID:  parent.UserID,
		Type:    sqlcgen.NotificationTypeCommentReply,
		ActorID: &comment.UserID,
		AnimeID: &thread.AnimeID,
		RefID:   &comment.ID,
		Payload: payload,
	}); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return nil
}

func (h *Handlers) handleNewFollower(ctx context.Context, t *asynq.Task) error {
	var p newFollowerPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	if err := h.q.InsertNotification(ctx, sqlcgen.InsertNotificationParams{
		UserID:  p.FolloweeID,
		Type:    sqlcgen.NotificationTypeNewFollower,
		ActorID: &p.FollowerID,
		Payload: []byte("{}"),
	}); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return nil
}

// lastAiredCheckKey remembers the high-water mark between cron runs.
const lastAiredCheckKey = "notify:aired:last_check"

// handleEpisodesAired alerts watchers about episodes that aired since the
// last run. First run (no high-water mark) looks back one hour only.
func (h *Handlers) handleEpisodesAired(ctx context.Context, _ *asynq.Task) error {
	now := time.Now().UTC()
	since := now.Add(-time.Hour)
	if raw, err := h.rdb.Get(ctx, lastAiredCheckKey).Result(); err == nil {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			since = t
		}
	}

	episodes, err := h.q.AiredEpisodesBetween(ctx, sqlcgen.AiredEpisodesBetweenParams{
		AiringAt:   &since,
		AiringAt_2: &now,
	})
	if err != nil {
		return fmt.Errorf("aired between: %w", err)
	}

	notified := 0
	for _, row := range episodes {
		watchers, err := h.q.WatcherIDs(ctx, row.Anime.ID)
		if err != nil {
			return fmt.Errorf("watchers of %d: %w", row.Anime.ID, err)
		}
		payload, _ := json.Marshal(map[string]any{"episode": row.Episode.Number})
		for _, userID := range watchers {
			if err := h.q.InsertNotification(ctx, sqlcgen.InsertNotificationParams{
				UserID:  userID,
				Type:    sqlcgen.NotificationTypeEpisodeAired,
				AnimeID: &row.Anime.ID,
				RefID:   &row.Episode.ID,
				Payload: payload,
			}); err != nil {
				return fmt.Errorf("insert notification: %w", err)
			}
			notified++
		}
	}

	if err := h.rdb.Set(ctx, lastAiredCheckKey, now.Format(time.RFC3339), 0).Err(); err != nil {
		h.log.Warn("notify: persist high-water mark", "err", err)
	}
	if notified > 0 {
		h.log.Info("episode-aired notifications sent", "episodes", len(episodes), "notifications", notified)
	}
	return nil
}

// threadLinkPayload records what the frontend needs to link a notification
// to the right page.
func threadLinkPayload(ctx context.Context, q *sqlcgen.Queries, thread sqlcgen.Thread) ([]byte, error) {
	link := map[string]any{"thread_id": thread.ID, "kind": thread.Kind}
	if thread.EpisodeID != nil {
		// Resolve the episode number for the deep link.
		episodes, err := q.ListEpisodes(ctx, thread.AnimeID)
		if err != nil {
			return nil, fmt.Errorf("list episodes: %w", err)
		}
		for _, e := range episodes {
			if e.ID == *thread.EpisodeID {
				link["episode"] = e.Number
				break
			}
		}
	}
	return json.Marshal(link)
}
