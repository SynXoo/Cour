package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"cour/internal/httpapi/apigen"
	"cour/internal/social"
	"cour/internal/store/sqlcgen"
)

type socialHandlers struct {
	svc *social.Service
	q   *sqlcgen.Queries
	log *slog.Logger
}

func (h socialHandlers) GetFollowState(w http.ResponseWriter, r *http.Request, username string) {
	var callerID *int64
	if id, ok := identity(r); ok {
		callerID = &id.UserID
	}
	state, err := h.svc.Relation(r.Context(), callerID, username)
	h.writeRelation(w, state, err)
}

func (h socialHandlers) FollowUser(w http.ResponseWriter, r *http.Request, username string) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	state, err := h.svc.Follow(r.Context(), id.UserID, username)
	h.writeRelation(w, state, err)
}

func (h socialHandlers) UnfollowUser(w http.ResponseWriter, r *http.Request, username string) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	state, err := h.svc.Unfollow(r.Context(), id.UserID, username)
	h.writeRelation(w, state, err)
}

func (h socialHandlers) writeRelation(w http.ResponseWriter, state social.RelationState, err error) {
	if err != nil {
		switch {
		case errors.Is(err, social.ErrUserNotFound):
			writeNotFound(w)
		case errors.Is(err, social.ErrSelfFollow):
			writeError(w, http.StatusBadRequest, CodeBadRequest, "you cannot follow yourself")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, apigen.RelationState{
		Followers:   int(state.Followers),
		Following:   int(state.Following),
		IsFollowing: state.IsFollowing,
	})
}

func (h socialHandlers) ListFollowers(w http.ResponseWriter, r *http.Request, username string) {
	rows, err := h.svc.Followers(r.Context(), username)
	if err != nil {
		if errors.Is(err, social.ErrUserNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.ReviewAuthor, len(rows))
	for i, row := range rows {
		data[i] = apigen.ReviewAuthor{Username: row.Username, AvatarUrl: row.AvatarUrl}
	}
	writeJSON(w, http.StatusOK, apigen.UserRefList{Data: data})
}

func (h socialHandlers) ListFollowing(w http.ResponseWriter, r *http.Request, username string) {
	rows, err := h.svc.Following(r.Context(), username)
	if err != nil {
		if errors.Is(err, social.ErrUserNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.ReviewAuthor, len(rows))
	for i, row := range rows {
		data[i] = apigen.ReviewAuthor{Username: row.Username, AvatarUrl: row.AvatarUrl}
	}
	writeJSON(w, http.StatusOK, apigen.UserRefList{Data: data})
}

func (h socialHandlers) GetMyFeed(w http.ResponseWriter, r *http.Request, params apigen.GetMyFeedParams) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	var cursor int64
	if params.Cursor != nil {
		cursor = *params.Cursor
	}
	limit := 25
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 50 {
		limit = *params.Limit
	}

	rows, next, err := h.svc.Feed(r.Context(), id.UserID, cursor, limit)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}

	data := make([]apigen.FeedItem, len(rows))
	for i, row := range rows {
		var payload map[string]any
		if err := json.Unmarshal(row.Activity.Payload, &payload); err != nil {
			payload = map[string]any{}
		}
		data[i] = apigen.FeedItem{
			Id:        row.Activity.ID,
			Actor:     apigen.ReviewAuthor{Username: row.User.Username, AvatarUrl: row.User.AvatarUrl},
			Type:      apigen.ActivityType(row.Activity.Type),
			Anime:     toSummary(row.Anime),
			RefId:     row.Activity.RefID,
			Payload:   payload,
			CreatedAt: row.Activity.CreatedAt,
		}
	}

	var nextCursor *int64
	if next > 0 {
		nextCursor = &next
	}
	writeJSON(w, http.StatusOK, apigen.Feed{Data: data, NextCursor: nextCursor})
}
