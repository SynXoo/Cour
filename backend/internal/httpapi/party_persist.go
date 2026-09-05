package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"cour/internal/discussions"
	"cour/internal/realtime"
	"cour/internal/store/sqlcgen"
)

// partyPersister writes an opted-in party message into the episode thread
// through the same service path as a REST post, so the thread's SSE
// `comment.created`, the activity row and notifications all fire exactly as
// they would for a comment typed on the thread page. The party enriches the
// async record; it never bypasses it.
type partyPersister struct {
	svc *discussions.Service
	hub *realtime.Hub
	q   *sqlcgen.Queries
	log *slog.Logger
}

func (p partyPersister) PersistComment(ctx context.Context, userID, animeID int64, episode int32, body string, position *float64) (int64, error) {
	ec, err := p.svc.EpisodeThread(ctx, animeID, episode)
	if err != nil {
		return 0, fmt.Errorf("party persist: thread: %w", err)
	}
	in := discussions.PostInput{Body: body}
	if position != nil && *position >= 0 && *position < 36000 {
		ts := int32(*position)
		in.TimestampSeconds = &ts
	}
	comment, err := p.svc.Post(ctx, ec.Thread.ID, userID, in)
	if err != nil {
		if errors.Is(err, discussions.ErrProfanity) {
			return 0, realtime.ErrFlagged
		}
		return 0, fmt.Errorf("party persist: post: %w", err)
	}

	author, err := p.q.GetUser(ctx, userID)
	if err != nil {
		// The comment is in; only the broadcast's author decoration is
		// missing. Fall back to an id-only author rather than failing.
		author = sqlcgen.User{ID: userID}
	}
	dto := toComment(discussions.CommentView{
		Comment:   comment,
		Author:    author,
		Reactions: map[string]int64{},
		Mine:      map[string]bool{},
	})
	p.hub.Publish(ctx, comment.ThreadID, realtime.Encode(realtime.EventCommentCreated, dto))
	return comment.ID, nil
}
