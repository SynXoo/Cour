package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"cour/internal/httpapi/apigen"
	"cour/internal/social"
	"cour/internal/store/sqlcgen"
)

// Friends & interactions (docs/PHASE_2.md §M3.9) — handlers hang off the
// social slice, since friendships are a layer over follows.

func (h socialHandlers) BefriendUser(w http.ResponseWriter, r *http.Request, username string) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	// The body is optional: an empty request is a request without a note.
	var body apigen.FriendRequestBody
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, CodeBadRequest, "could not read request body")
		return
	}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "malformed JSON: "+err.Error())
			return
		}
	}
	note := ""
	if body.Note != nil {
		note = *body.Note
	}
	state, err := h.svc.Befriend(r.Context(), id.UserID, username, note)
	h.writeFriendRelation(w, state, err)
}

func (h socialHandlers) UnfriendUser(w http.ResponseWriter, r *http.Request, username string) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	state, err := h.svc.Unfriend(r.Context(), id.UserID, username)
	h.writeFriendRelation(w, state, err)
}

func (h socialHandlers) writeFriendRelation(w http.ResponseWriter, state social.RelationState, err error) {
	if err != nil {
		switch {
		case errors.Is(err, social.ErrUserNotFound):
			writeNotFound(w)
		case errors.Is(err, social.ErrSelfFriend):
			writeError(w, http.StatusBadRequest, CodeBadRequest, "you cannot befriend yourself")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	h.writeRelation(w, state, nil)
}

func (h socialHandlers) ListUserFriends(w http.ResponseWriter, r *http.Request, username string) {
	rows, err := h.svc.FriendsOf(r.Context(), username)
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

func (h socialHandlers) GetMyFriends(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	ov, err := h.svc.Overview(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	out := apigen.FriendsOverview{
		Friends:   make([]apigen.FriendRef, len(ov.Friends)),
		Incoming:  make([]apigen.FriendRequest, len(ov.Incoming)),
		Outgoing:  make([]apigen.FriendRequest, len(ov.Outgoing)),
		Suggested: make([]apigen.ReviewAuthor, len(ov.Suggested)),
	}
	for i, f := range ov.Friends {
		out.Friends[i] = apigen.FriendRef{Username: f.Username, AvatarUrl: f.AvatarUrl, Since: f.Since}
	}
	for i, req := range ov.Incoming {
		out.Incoming[i] = apigen.FriendRequest{
			User:      apigen.ReviewAuthor{Username: req.Username, AvatarUrl: req.AvatarUrl},
			Note:      req.Note,
			CreatedAt: req.CreatedAt,
		}
	}
	for i, req := range ov.Outgoing {
		out.Outgoing[i] = apigen.FriendRequest{
			User:      apigen.ReviewAuthor{Username: req.Username, AvatarUrl: req.AvatarUrl},
			Note:      req.Note,
			CreatedAt: req.CreatedAt,
		}
	}
	for i, s := range ov.Suggested {
		out.Suggested[i] = apigen.ReviewAuthor{Username: s.Username, AvatarUrl: s.AvatarUrl}
	}
	writeJSON(w, http.StatusOK, out)
}

func (h socialHandlers) SearchUsers(w http.ResponseWriter, r *http.Request, params apigen.SearchUsersParams) {
	rows, err := h.svc.SearchUsers(r.Context(), params.Q)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.ReviewAuthor, len(rows))
	for i, row := range rows {
		data[i] = apigen.ReviewAuthor{Username: row.Username, AvatarUrl: row.AvatarUrl}
	}
	writeJSON(w, http.StatusOK, apigen.UserRefList{Data: data})
}

func (h socialHandlers) GetAnimeFriends(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	rows, recs, err := h.svc.FriendsOnAnime(r.Context(), id.UserID, animeID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	out := apigen.FriendsOnAnime{
		Data:            make([]apigen.FriendOnAnime, len(rows)),
		Recommendations: make([]apigen.AnimeRecommendation, len(recs)),
	}
	for i, row := range rows {
		item := apigen.FriendOnAnime{
			User:     apigen.ReviewAuthor{Username: row.Username, AvatarUrl: row.AvatarUrl},
			Status:   apigen.ListStatus(row.Status),
			Progress: int(row.Progress),
		}
		if row.Score != nil {
			v := int(*row.Score)
			item.Score = &v
		}
		out.Data[i] = item
	}
	for i, rec := range recs {
		out.Recommendations[i] = apigen.AnimeRecommendation{
			From:      apigen.ReviewAuthor{Username: rec.Username, AvatarUrl: rec.AvatarUrl},
			Note:      rec.Note,
			CreatedAt: rec.CreatedAt,
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (h socialHandlers) RecommendAnime(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.RecommendRequest](w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(req.To) == "" {
		writeValidation(w, map[string]string{"to": "friend's username is required"})
		return
	}
	note := ""
	if req.Note != nil {
		note = *req.Note
	}
	err := h.svc.Recommend(r.Context(), id.UserID, animeID, req.To, note)
	if err != nil {
		switch {
		case errors.Is(err, social.ErrUserNotFound), errors.Is(err, social.ErrAnimeNotFound):
			writeNotFound(w)
		case errors.Is(err, social.ErrSelfFriend):
			writeError(w, http.StatusBadRequest, CodeBadRequest, "you cannot recommend a show to yourself")
		case errors.Is(err, social.ErrNotFriends):
			writeError(w, http.StatusForbidden, CodeForbidden, "you can only recommend shows to friends")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h socialHandlers) GetFriendRecommendations(w http.ResponseWriter, r *http.Request, params apigen.GetFriendRecommendationsParams) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	limit := 12
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 50 {
		limit = *params.Limit
	}
	rows, err := h.svc.FriendRecommendations(r.Context(), id.UserID, limit)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.FriendRecommendation, len(rows))
	for i, row := range rows {
		data[i] = apigen.FriendRecommendation{
			Anime:     toSummary(row.Anime),
			From:      apigen.ReviewAuthor{Username: row.Username, AvatarUrl: row.AvatarUrl},
			Note:      row.Note,
			CreatedAt: row.CreatedAt,
		}
	}
	writeJSON(w, http.StatusOK, apigen.FriendRecommendationList{Data: data})
}

// toDirectMessage maps a row to the wire shape for one viewer.
func toDirectMessage(m sqlcgen.DmMessage, viewerID int64, viewerName, peerName string) apigen.DirectMessage {
	out := apigen.DirectMessage{Id: m.ID, Body: m.Body, CreatedAt: m.CreatedAt, Mine: m.SenderID == viewerID}
	if out.Mine {
		out.Sender = viewerName
	} else {
		out.Sender = peerName
	}
	return out
}
