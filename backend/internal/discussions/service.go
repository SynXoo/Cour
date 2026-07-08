// Package discussions implements the watching-along layer: a series board
// per anime, a thread per episode, nested comments with optional moment
// anchors (timestamps), and emoji reactions.
//
// Phase-2 note: timestamped comments are the async form of the watch-party
// "moment" events — a live party will emit the same shape onto the same
// threads.
package discussions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/store/sqlcgen"
)

var (
	ErrNotFound      = errors.New("discussions: not found")
	ErrBadParent     = errors.New("discussions: parent comment not in this thread")
	ErrNoTimestamps  = errors.New("discussions: timestamps only apply to episode threads")
	ErrForbidden     = errors.New("discussions: not allowed")
	ErrEmptyBody     = errors.New("discussions: comment body required")
	ErrBadEmoji      = errors.New("discussions: unknown reaction")
	ErrAnimeNotFound = errors.New("discussions: anime not found")
	ErrProfanity     = errors.New("discussions: language policy violation")
)

// TextFilter is the profanity hook (see internal/moderation).
type TextFilter interface {
	Flagged(text string) bool
}

var validEmojis = map[string]bool{
	"+1": true, "heart": true, "laugh": true, "surprise": true, "cry": true, "fire": true,
}

const maxBodyLen = 8000

// Notifier is the seam the notifications slice plugs into: called after a
// comment lands, outside the transaction.
type Notifier interface {
	CommentPosted(ctx context.Context, comment sqlcgen.Comment, thread sqlcgen.Thread)
}

type Service struct {
	q        *sqlcgen.Queries
	pool     *pgxpool.Pool
	notifier Notifier   // nil until the notifications slice registers one
	filter   TextFilter // nil = no language policy
	log      *slog.Logger
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), pool: pool, log: log}
}

// SetNotifier wires the notification fan-out (slice 8).
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

// SetTextFilter wires the profanity hook (slice 10).
func (s *Service) SetTextFilter(f TextFilter) { s.filter = f }

// SeriesThreadIfExists returns the board or nil without creating it (for
// the read-only thread index).
func (s *Service) SeriesThreadIfExists(ctx context.Context, animeID int64) (*sqlcgen.Thread, error) {
	thread, err := s.q.GetSeriesThread(ctx, animeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get series thread: %w", err)
	}
	return &thread, nil
}

// SeriesThread returns the anime's board, creating it on first access.
func (s *Service) SeriesThread(ctx context.Context, animeID int64) (sqlcgen.Thread, error) {
	thread, err := s.q.GetSeriesThread(ctx, animeID)
	if err == nil {
		return thread, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.Thread{}, fmt.Errorf("get series thread: %w", err)
	}
	if _, err := s.q.GetAnime(ctx, animeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Thread{}, ErrAnimeNotFound
		}
		return sqlcgen.Thread{}, fmt.Errorf("get anime: %w", err)
	}

	thread, err = s.q.CreateSeriesThread(ctx, animeID)
	if err == nil {
		return thread, nil
	}
	// ON CONFLICT DO NOTHING returns no rows when we lost the race.
	if errors.Is(err, pgx.ErrNoRows) {
		return s.q.GetSeriesThread(ctx, animeID)
	}
	return sqlcgen.Thread{}, fmt.Errorf("create series thread: %w", err)
}

// EpisodeContext is an episode thread plus everything the page needs.
type EpisodeContext struct {
	Thread  sqlcgen.Thread
	Episode sqlcgen.Episode
	Anime   sqlcgen.Anime
}

// EpisodeThread resolves (anime, episode number) to its thread, creating it
// on first access.
func (s *Service) EpisodeThread(ctx context.Context, animeID int64, number int32) (EpisodeContext, error) {
	anime, err := s.q.GetAnime(ctx, animeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EpisodeContext{}, ErrAnimeNotFound
		}
		return EpisodeContext{}, fmt.Errorf("get anime: %w", err)
	}
	episode, err := s.q.GetEpisodeByNumber(ctx, sqlcgen.GetEpisodeByNumberParams{AnimeID: animeID, Number: number})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EpisodeContext{}, ErrNotFound
		}
		return EpisodeContext{}, fmt.Errorf("get episode: %w", err)
	}

	thread, err := s.q.GetEpisodeThread(ctx, &episode.ID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return EpisodeContext{}, fmt.Errorf("get episode thread: %w", err)
		}
		thread, err = s.q.CreateEpisodeThread(ctx, sqlcgen.CreateEpisodeThreadParams{
			AnimeID: animeID, EpisodeID: &episode.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			thread, err = s.q.GetEpisodeThread(ctx, &episode.ID)
		}
		if err != nil {
			return EpisodeContext{}, fmt.Errorf("create episode thread: %w", err)
		}
	}
	return EpisodeContext{Thread: thread, Episode: episode, Anime: anime}, nil
}

func (s *Service) Thread(ctx context.Context, threadID int64) (sqlcgen.Thread, error) {
	thread, err := s.q.GetThread(ctx, threadID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Thread{}, ErrNotFound
		}
		return sqlcgen.Thread{}, fmt.Errorf("get thread: %w", err)
	}
	return thread, nil
}

func (s *Service) EpisodeThreadSummaries(ctx context.Context, animeID int64) ([]sqlcgen.ListEpisodeThreadSummariesRow, error) {
	rows, err := s.q.ListEpisodeThreadSummaries(ctx, animeID)
	if err != nil {
		return nil, fmt.Errorf("thread summaries: %w", err)
	}
	return rows, nil
}

// CommentView is a comment with its author and reaction aggregates.
type CommentView struct {
	Comment   sqlcgen.Comment
	Author    sqlcgen.User
	Reactions map[string]int64 // emoji -> count
	Mine      map[string]bool  // emoji -> caller reacted
}

// Comments returns one newest-first keyset page of a thread's comments (clients
// reverse the merged pages and build the tree), with reactions aggregated and
// the caller's own reactions marked. beforeID is the exclusive upper id bound
// (math.MaxInt64 for the newest page); nextCursor is the oldest id on this page
// when an older page exists, else nil.
func (s *Service) Comments(ctx context.Context, threadID int64, callerID *int64, beforeID int64, limit int) (views []CommentView, nextCursor *int64, err error) {
	if _, err := s.Thread(ctx, threadID); err != nil {
		return nil, nil, err
	}
	// Fetch one extra to tell whether an older page exists without a count query.
	rows, err := s.q.ListComments(ctx, sqlcgen.ListCommentsParams{
		ThreadID: threadID, BeforeID: beforeID, PageLimit: int32(limit) + 1,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("list comments: %w", err)
	}
	if len(rows) > limit {
		rows = rows[:limit]
		oldest := rows[len(rows)-1].Comment.ID // DESC page → last row is the oldest
		nextCursor = &oldest
	}

	ids := make([]int64, len(rows))
	views = make([]CommentView, len(rows))
	for i, row := range rows {
		ids[i] = row.Comment.ID
		views[i] = CommentView{
			Comment:   row.Comment,
			Author:    row.User,
			Reactions: map[string]int64{},
			Mine:      map[string]bool{},
		}
	}
	if len(ids) == 0 {
		return views, nextCursor, nil
	}

	byID := make(map[int64]*CommentView, len(views))
	for i := range views {
		byID[views[i].Comment.ID] = &views[i]
	}

	counts, err := s.q.ReactionCounts(ctx, ids)
	if err != nil {
		return nil, nil, fmt.Errorf("reaction counts: %w", err)
	}
	for _, c := range counts {
		if v, ok := byID[c.CommentID]; ok {
			v.Reactions[c.Emoji] = c.Count
		}
	}

	if callerID != nil {
		mine, err := s.q.UserReactions(ctx, sqlcgen.UserReactionsParams{UserID: *callerID, Column2: ids})
		if err != nil {
			return nil, nil, fmt.Errorf("user reactions: %w", err)
		}
		for _, m := range mine {
			if v, ok := byID[m.CommentID]; ok {
				v.Mine[m.Emoji] = true
			}
		}
	}
	return views, nextCursor, nil
}

type PostInput struct {
	ParentID         *int64
	Body             string
	TimestampSeconds *int32
	HasSpoilers      bool
}

// Post appends a comment: validates the parent and timestamp semantics, then
// inserts, bumps the thread, and records the activity in one transaction.
func (s *Service) Post(ctx context.Context, threadID, userID int64, in PostInput) (sqlcgen.Comment, error) {
	thread, err := s.Thread(ctx, threadID)
	if err != nil {
		return sqlcgen.Comment{}, err
	}

	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" {
		return sqlcgen.Comment{}, ErrEmptyBody
	}
	if len(in.Body) > maxBodyLen {
		return sqlcgen.Comment{}, fmt.Errorf("%w: body too long", ErrEmptyBody)
	}
	if s.filter != nil && s.filter.Flagged(in.Body) {
		return sqlcgen.Comment{}, ErrProfanity
	}
	if in.TimestampSeconds != nil && thread.Kind != sqlcgen.ThreadKindEpisode {
		return sqlcgen.Comment{}, ErrNoTimestamps
	}
	if in.ParentID != nil {
		parent, err := s.q.GetComment(ctx, *in.ParentID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sqlcgen.Comment{}, ErrBadParent
			}
			return sqlcgen.Comment{}, fmt.Errorf("get parent: %w", err)
		}
		if parent.ThreadID != threadID || parent.DeletedAt != nil {
			return sqlcgen.Comment{}, ErrBadParent
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.Comment{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	comment, err := qtx.CreateComment(ctx, sqlcgen.CreateCommentParams{
		ThreadID:         threadID,
		ParentID:         in.ParentID,
		UserID:           userID,
		Body:             in.Body,
		TimestampSeconds: in.TimestampSeconds,
		HasSpoilers:      in.HasSpoilers,
	})
	if err != nil {
		return sqlcgen.Comment{}, fmt.Errorf("create comment: %w", err)
	}
	if err := qtx.BumpThread(ctx, threadID); err != nil {
		return sqlcgen.Comment{}, fmt.Errorf("bump thread: %w", err)
	}

	payload, _ := json.Marshal(map[string]any{"thread_id": threadID, "kind": thread.Kind})
	if err := qtx.InsertActivity(ctx, sqlcgen.InsertActivityParams{
		UserID: userID, Type: sqlcgen.ActivityTypeComment,
		AnimeID: &thread.AnimeID, RefID: &comment.ID, Payload: payload,
	}); err != nil {
		return sqlcgen.Comment{}, fmt.Errorf("insert activity: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.Comment{}, fmt.Errorf("commit: %w", err)
	}

	if s.notifier != nil {
		s.notifier.CommentPosted(ctx, comment, thread)
	}
	return comment, nil
}

// Delete soft-deletes a comment and returns its thread id so the caller can
// broadcast the removal.
func (s *Service) Delete(ctx context.Context, commentID, callerID int64, callerIsMod bool) (threadID int64, err error) {
	comment, err := s.q.GetComment(ctx, commentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("get comment: %w", err)
	}
	if comment.UserID != callerID && !callerIsMod {
		return 0, ErrForbidden
	}
	if _, err := s.q.SoftDeleteComment(ctx, commentID); err != nil {
		return 0, fmt.Errorf("soft delete: %w", err)
	}
	return comment.ThreadID, nil
}

// React toggles a caller's reaction and returns the comment's thread id and
// the emoji's new absolute count, so the caller can broadcast the change.
func (s *Service) React(ctx context.Context, commentID, userID int64, emoji string, on bool) (threadID, count int64, err error) {
	if !validEmojis[emoji] {
		return 0, 0, ErrBadEmoji
	}
	comment, err := s.q.GetComment(ctx, commentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, 0, ErrNotFound
		}
		return 0, 0, fmt.Errorf("get comment: %w", err)
	}
	if comment.DeletedAt != nil {
		return 0, 0, ErrNotFound
	}

	if on {
		_, err = s.q.AddReaction(ctx, sqlcgen.AddReactionParams{CommentID: commentID, UserID: userID, Emoji: emoji})
	} else {
		_, err = s.q.RemoveReaction(ctx, sqlcgen.RemoveReactionParams{CommentID: commentID, UserID: userID, Emoji: emoji})
	}
	if err != nil {
		return 0, 0, fmt.Errorf("reaction: %w", err)
	}
	count, err = s.q.ReactionCountFor(ctx, sqlcgen.ReactionCountForParams{CommentID: commentID, Emoji: emoji})
	if err != nil {
		return 0, 0, fmt.Errorf("reaction count: %w", err)
	}
	return comment.ThreadID, count, nil
}

// Tombstone text for deleted comments; the row keeps its place in the tree.
const DeletedBody = "[removed]"

// PublicBody hides deleted content.
func PublicBody(c sqlcgen.Comment) string {
	if c.DeletedAt != nil {
		return DeletedBody
	}
	return c.Body
}

// ParseTimestamp converts "mm:ss" or "h:mm:ss" to seconds.
func ParseTimestamp(s string) (int32, error) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, fmt.Errorf("discussions: timestamp must be mm:ss or h:mm:ss")
	}
	var total time.Duration
	units := []time.Duration{time.Second, time.Minute, time.Hour}
	for i := 0; i < len(parts); i++ {
		var n int
		if _, err := fmt.Sscanf(parts[len(parts)-1-i], "%d", &n); err != nil || n < 0 {
			return 0, fmt.Errorf("discussions: bad timestamp segment %q", parts[len(parts)-1-i])
		}
		total += time.Duration(n) * units[i]
	}
	return int32(total / time.Second), nil
}
