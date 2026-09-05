package httpapi

import (
	"errors"
	"net/http"

	"cour/internal/httpapi/apigen"
	"cour/internal/social"
)

// Direct messages (docs/PHASE_2.md §M3.9), friends only.

func (h socialHandlers) GetMyInbox(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	rows, err := h.svc.Inbox(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.InboxEntry, len(rows))
	for i, row := range rows {
		data[i] = apigen.InboxEntry{
			Peer:     apigen.ReviewAuthor{Username: row.PeerUsername, AvatarUrl: row.PeerAvatar},
			LastBody: row.LastBody,
			LastMine: row.LastSenderID == id.UserID,
			LastAt:   row.LastAt,
			Unread:   int(row.Unread),
		}
	}
	writeJSON(w, http.StatusOK, apigen.Inbox{Data: data})
}

func (h socialHandlers) GetUnreadMessageCount(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	n, err := h.svc.UnreadMessages(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, apigen.UnreadCount{Count: int(n)})
}

func (h socialHandlers) GetConversation(w http.ResponseWriter, r *http.Request, username string, params apigen.GetConversationParams) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	var before int64
	if params.BeforeId != nil {
		before = *params.BeforeId
	}
	limit := 50
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 100 {
		limit = *params.Limit
	}
	peer, msgs, next, err := h.svc.Conversation(r.Context(), id.UserID, username, before, limit)
	if err != nil {
		h.writeMessageError(w, err)
		return
	}
	data := make([]apigen.DirectMessage, len(msgs))
	for i, m := range msgs {
		data[i] = toDirectMessage(m, id.UserID, id.Username, peer.Username)
	}
	var nextCursor *int64
	if next > 0 {
		nextCursor = &next
	}
	writeJSON(w, http.StatusOK, apigen.MessagePage{Data: data, NextCursor: nextCursor})
}

func (h socialHandlers) SendMessage(w http.ResponseWriter, r *http.Request, username string) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.SendMessageRequest](w, r)
	if !ok {
		return
	}
	msg, err := h.svc.Send(r.Context(), id.UserID, username, req.Body)
	if err != nil {
		h.writeMessageError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toDirectMessage(msg, id.UserID, id.Username, username))
}

func (h socialHandlers) MarkConversationRead(w http.ResponseWriter, r *http.Request, username string) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if err := h.svc.MarkRead(r.Context(), id.UserID, username); err != nil {
		h.writeMessageError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h socialHandlers) writeMessageError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, social.ErrUserNotFound):
		writeNotFound(w)
	case errors.Is(err, social.ErrSelfFriend):
		writeError(w, http.StatusBadRequest, CodeBadRequest, "you cannot message yourself")
	case errors.Is(err, social.ErrNotFriends):
		writeError(w, http.StatusForbidden, CodeForbidden, "you can only message friends")
	case errors.Is(err, social.ErrEmptyMessage):
		writeValidation(w, map[string]string{"body": "must be 1-2000 characters"})
	default:
		writeInternal(w, h.log, err)
	}
}
