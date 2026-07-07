package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"cour/internal/discussions"
	"cour/internal/httpapi/apigen"
	"cour/internal/realtime"
	"cour/internal/store/sqlcgen"
)

type discussionHandlers struct {
	svc *discussions.Service
	hub *realtime.Hub
	log *slog.Logger
}

// SSE payloads for streamThreadEvents. They mirror the CommentDeleted /
// ReactionUpdate schemas in openapi.yaml; the operation is hand-routed and
// excluded from codegen, so these aren't generated. comment.created reuses the
// REST apigen.Comment; presence is realtime's own payload.
type commentDeletedEvent struct {
	CommentID int64 `json:"comment_id"`
}

type reactionUpdateEvent struct {
	CommentID int64        `json:"comment_id"`
	Emoji     apigen.Emoji `json:"emoji"`
	Count     int          `json:"count"`
}

// pingInterval keeps intermediaries from closing an idle SSE connection. The
// stream is hand-routed past the 30s request timeout, so this is the only
// periodic write on a quiet thread.
const pingInterval = 25 * time.Second

func (h discussionHandlers) GetAnimeThreads(w http.ResponseWriter, r *http.Request, animeID int64) {
	series, err := h.svc.SeriesThreadIfExists(r.Context(), animeID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	episodes, err := h.svc.EpisodeThreadSummaries(r.Context(), animeID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}

	idx := apigen.ThreadIndex{
		Episodes: make([]struct {
			CommentCount   int       `json:"comment_count"`
			LastActivityAt time.Time `json:"last_activity_at"`
			Number         int       `json:"number"`
			ThreadId       int64     `json:"thread_id"`
		}, len(episodes)),
	}
	if series != nil {
		t := toThread(*series)
		idx.Series = &t
	}
	for i, e := range episodes {
		idx.Episodes[i].Number = int(e.Number)
		idx.Episodes[i].ThreadId = e.ThreadID
		idx.Episodes[i].CommentCount = int(e.CommentCount)
		idx.Episodes[i].LastActivityAt = e.LastActivityAt
	}
	writeJSON(w, http.StatusOK, idx)
}

func (h discussionHandlers) GetSeriesThread(w http.ResponseWriter, r *http.Request, animeID int64) {
	thread, err := h.svc.SeriesThread(r.Context(), animeID)
	if err != nil {
		if errors.Is(err, discussions.ErrAnimeNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toThread(thread))
}

func (h discussionHandlers) GetEpisodeThread(w http.ResponseWriter, r *http.Request, animeID int64, number int) {
	ec, err := h.svc.EpisodeThread(r.Context(), animeID, int32(number))
	if err != nil {
		if errors.Is(err, discussions.ErrAnimeNotFound) || errors.Is(err, discussions.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, apigen.EpisodeThread{
		Thread: toThread(ec.Thread),
		Anime:  toSummary(ec.Anime),
		Episode: apigen.Episode{
			Number:   int(ec.Episode.Number),
			Title:    ec.Episode.Title,
			AiringAt: ec.Episode.AiringAt,
		},
	})
}

func (h discussionHandlers) ListComments(w http.ResponseWriter, r *http.Request, threadID int64) {
	var callerID *int64
	if id, ok := identity(r); ok {
		callerID = &id.UserID
	}
	views, err := h.svc.Comments(r.Context(), threadID, callerID)
	if err != nil {
		if errors.Is(err, discussions.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}

	data := make([]apigen.Comment, len(views))
	for i, v := range views {
		data[i] = toComment(v)
	}
	writeJSON(w, http.StatusOK, apigen.CommentList{Data: data})
}

func (h discussionHandlers) PostComment(w http.ResponseWriter, r *http.Request, threadID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.PostCommentRequest](w, r)
	if !ok {
		return
	}

	in := discussions.PostInput{
		ParentID: req.ParentId,
		Body:     req.Body,
	}
	if req.TimestampSeconds != nil {
		v := int32(*req.TimestampSeconds)
		if v < 0 || v >= 36000 {
			writeValidation(w, map[string]string{"timestamp_seconds": "must be between 0 and 35999"})
			return
		}
		in.TimestampSeconds = &v
	}
	if req.HasSpoilers != nil {
		in.HasSpoilers = *req.HasSpoilers
	}

	comment, err := h.svc.Post(r.Context(), threadID, id.UserID, in)
	if err != nil {
		switch {
		case errors.Is(err, discussions.ErrNotFound):
			writeNotFound(w)
		case errors.Is(err, discussions.ErrBadParent):
			writeValidation(w, map[string]string{"parent_id": "must reference a live comment in this thread"})
		case errors.Is(err, discussions.ErrNoTimestamps):
			writeValidation(w, map[string]string{"timestamp_seconds": "only episode threads accept timestamps"})
		case errors.Is(err, discussions.ErrEmptyBody):
			writeValidation(w, map[string]string{"body": "must be 1-8000 characters"})
		case errors.Is(err, discussions.ErrProfanity):
			writeValidation(w, map[string]string{"body": "violates the language policy"})
		default:
			writeInternal(w, h.log, err)
		}
		return
	}

	dto := toComment(discussions.CommentView{
		Comment:   comment,
		Author:    sqlcgen.User{Username: id.Username},
		Reactions: map[string]int64{},
		Mine:      map[string]bool{},
	})
	// Broadcast the same shape the client already caches from REST, so its
	// live merge is a plain append. Post-commit and best-effort.
	h.hub.Publish(r.Context(), comment.ThreadID, realtime.Encode(realtime.EventCommentCreated, dto))
	writeJSON(w, http.StatusCreated, dto)
}

func (h discussionHandlers) DeleteComment(w http.ResponseWriter, r *http.Request, commentID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	threadID, err := h.svc.Delete(r.Context(), commentID, id.UserID, id.IsMod())
	if err != nil {
		switch {
		case errors.Is(err, discussions.ErrNotFound):
			writeNotFound(w)
		case errors.Is(err, discussions.ErrForbidden):
			writeError(w, http.StatusForbidden, CodeForbidden, "you can only delete your own comments")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	h.hub.Publish(r.Context(), threadID, realtime.Encode(realtime.EventCommentDeleted, commentDeletedEvent{CommentID: commentID}))
	w.WriteHeader(http.StatusNoContent)
}

func (h discussionHandlers) AddReaction(w http.ResponseWriter, r *http.Request, commentID int64, emoji apigen.Emoji) {
	h.react(w, r, commentID, string(emoji), true)
}

func (h discussionHandlers) RemoveReaction(w http.ResponseWriter, r *http.Request, commentID int64, emoji apigen.Emoji) {
	h.react(w, r, commentID, string(emoji), false)
}

func (h discussionHandlers) react(w http.ResponseWriter, r *http.Request, commentID int64, emoji string, on bool) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	threadID, count, err := h.svc.React(r.Context(), commentID, id.UserID, emoji, on)
	if err != nil {
		switch {
		case errors.Is(err, discussions.ErrNotFound):
			writeNotFound(w)
		case errors.Is(err, discussions.ErrBadEmoji):
			writeError(w, http.StatusBadRequest, CodeBadRequest, "unknown reaction")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	h.hub.Publish(r.Context(), threadID, realtime.Encode(realtime.EventReactionUpdated, reactionUpdateEvent{
		CommentID: commentID,
		Emoji:     apigen.Emoji(emoji),
		Count:     int(count),
	}))
	w.WriteHeader(http.StatusNoContent)
}

// StreamThreadEvents is the SSE endpoint (GET /threads/{threadId}/events). It
// is hand-routed in server.go — outside the 30s request timeout and excluded
// from codegen — so the connection lives until the client disconnects.
func (h discussionHandlers) StreamThreadEvents(w http.ResponseWriter, r *http.Request) {
	threadID, err := strconv.ParseInt(chi.URLParam(r, "threadId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, CodeBadRequest, "invalid thread id")
		return
	}
	if _, err := h.svc.Thread(r.Context(), threadID); err != nil {
		if errors.Is(err, discussions.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeInternal(w, h.log, errors.New("streaming unsupported by the response writer"))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	// Defeat proxy buffering (nginx) so events aren't held back.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Subscribe before the loop; the initial presence event is already queued
	// on the channel by the time we start reading.
	events, cleanup := h.hub.Subscribe(threadID)
	defer cleanup()

	ping := time.NewTicker(pingInterval)
	defer ping.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-events:
			if err := writeSSEEvent(w, ev.Name, ev.Data); err != nil {
				return
			}
			flusher.Flush()
		case <-ping.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSEEvent frames one named event. json.Marshal produces single-line
// data, so a single `data:` line is always valid.
func writeSSEEvent(w io.Writer, name string, data []byte) error {
	if _, err := fmt.Fprintf(w, "event: %s\ndata: ", name); err != nil {
		return err
	}
	if _, err := w.Write(data); err != nil {
		return err
	}
	_, err := io.WriteString(w, "\n\n")
	return err
}

// ── DTOs ───────────────────────────────────────────────────────────────────

func toThread(t sqlcgen.Thread) apigen.Thread {
	return apigen.Thread{
		Id:             t.ID,
		AnimeId:        t.AnimeID,
		Kind:           apigen.ThreadKind(t.Kind),
		CommentCount:   int(t.CommentCount),
		LastActivityAt: t.LastActivityAt,
	}
}

func toComment(v discussions.CommentView) apigen.Comment {
	reactions := make([]apigen.ReactionCount, 0, len(v.Reactions))
	for emoji, count := range v.Reactions {
		reactions = append(reactions, apigen.ReactionCount{
			Emoji: apigen.Emoji(emoji),
			Count: int(count),
			Mine:  v.Mine[emoji],
		})
	}
	sortReactions(reactions)

	var timestamp *int
	if v.Comment.TimestampSeconds != nil {
		n := int(*v.Comment.TimestampSeconds)
		timestamp = &n
	}

	return apigen.Comment{
		Id:               v.Comment.ID,
		ThreadId:         v.Comment.ThreadID,
		ParentId:         v.Comment.ParentID,
		Author:           apigen.ReviewAuthor{Username: v.Author.Username, AvatarUrl: v.Author.AvatarUrl},
		Body:             discussions.PublicBody(v.Comment),
		TimestampSeconds: timestamp,
		HasSpoilers:      v.Comment.HasSpoilers,
		Deleted:          v.Comment.DeletedAt != nil,
		Reactions:        reactions,
		CreatedAt:        v.Comment.CreatedAt,
	}
}

// sortReactions keeps a stable emoji order for rendering.
var emojiOrder = map[apigen.Emoji]int{
	"+1": 0, "heart": 1, "laugh": 2, "surprise": 3, "cry": 4, "fire": 5,
}

func sortReactions(rs []apigen.ReactionCount) {
	slices.SortFunc(rs, func(a, b apigen.ReactionCount) int {
		return emojiOrder[a.Emoji] - emojiOrder[b.Emoji]
	})
}
