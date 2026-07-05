package httpapi

import (
	"encoding/json"
	"log/slog"
	"math"
	"net/http"

	"cour/internal/httpapi/apigen"
	"cour/internal/store/sqlcgen"
)

type notificationHandlers struct {
	q   *sqlcgen.Queries
	log *slog.Logger
}

func (h notificationHandlers) GetMyNotifications(w http.ResponseWriter, r *http.Request, params apigen.GetMyNotificationsParams) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	cursor := int64(math.MaxInt64)
	if params.Cursor != nil && *params.Cursor > 0 {
		cursor = *params.Cursor
	}
	limit := 20
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 50 {
		limit = *params.Limit
	}

	rows, err := h.q.ListNotifications(r.Context(), sqlcgen.ListNotificationsParams{
		UserID: id.UserID,
		ID:     cursor,
		Limit:  int32(limit) + 1,
	})
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}

	var nextCursor *int64
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[len(rows)-1].Notification.ID
		nextCursor = &last
	}

	// Hydrate anime summaries in one query.
	animeIDs := make([]int64, 0, len(rows))
	seen := map[int64]bool{}
	for _, row := range rows {
		if row.Notification.AnimeID != nil && !seen[*row.Notification.AnimeID] {
			seen[*row.Notification.AnimeID] = true
			animeIDs = append(animeIDs, *row.Notification.AnimeID)
		}
	}
	animeByID := map[int64]apigen.AnimeSummary{}
	if len(animeIDs) > 0 {
		animeRows, err := h.q.ListAnimeByIDs(r.Context(), animeIDs)
		if err != nil {
			writeInternal(w, h.log, err)
			return
		}
		for _, a := range animeRows {
			animeByID[a.ID] = toSummary(a)
		}
	}

	data := make([]apigen.Notification, len(rows))
	for i, row := range rows {
		n := row.Notification
		var payload map[string]any
		if err := json.Unmarshal(n.Payload, &payload); err != nil {
			payload = map[string]any{}
		}
		item := apigen.Notification{
			Id:        n.ID,
			Type:      apigen.NotificationType(n.Type),
			RefId:     n.RefID,
			Payload:   payload,
			Read:      n.ReadAt != nil,
			CreatedAt: n.CreatedAt,
		}
		if row.ActorUsername != nil {
			item.Actor = &apigen.ReviewAuthor{Username: *row.ActorUsername, AvatarUrl: row.ActorAvatar}
		}
		if n.AnimeID != nil {
			if summary, ok := animeByID[*n.AnimeID]; ok {
				item.Anime = &summary
			}
		}
		data[i] = item
	}
	writeJSON(w, http.StatusOK, apigen.NotificationList{Data: data, NextCursor: nextCursor})
}

func (h notificationHandlers) GetUnreadCount(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	count, err := h.q.CountUnreadNotifications(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, apigen.UnreadCount{Count: int(count)})
}

func (h notificationHandlers) MarkNotificationsRead(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.MarkReadRequest](w, r)
	if !ok {
		return
	}

	if req.All != nil && *req.All {
		if err := h.q.MarkAllNotificationsRead(r.Context(), id.UserID); err != nil {
			writeInternal(w, h.log, err)
			return
		}
	} else if req.Ids != nil && len(*req.Ids) > 0 {
		if err := h.q.MarkNotificationsRead(r.Context(), sqlcgen.MarkNotificationsReadParams{
			UserID:  id.UserID,
			Column2: *req.Ids,
		}); err != nil {
			writeInternal(w, h.log, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
