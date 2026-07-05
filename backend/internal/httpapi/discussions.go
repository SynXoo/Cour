package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"cour/internal/discussions"
	"cour/internal/httpapi/apigen"
	"cour/internal/store/sqlcgen"
)

type discussionHandlers struct {
	svc *discussions.Service
	log *slog.Logger
}

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
		default:
			writeInternal(w, h.log, err)
		}
		return
	}

	writeJSON(w, http.StatusCreated, toComment(discussions.CommentView{
		Comment:   comment,
		Author:    sqlcgen.User{Username: id.Username},
		Reactions: map[string]int64{},
		Mine:      map[string]bool{},
	}))
}

func (h discussionHandlers) DeleteComment(w http.ResponseWriter, r *http.Request, commentID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), commentID, id.UserID, id.IsMod()); err != nil {
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
	if err := h.svc.React(r.Context(), commentID, id.UserID, emoji, on); err != nil {
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
	w.WriteHeader(http.StatusNoContent)
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
