package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/oapi-codegen/runtime/types"

	"cour/internal/httpapi/apigen"
	"cour/internal/lists"
	"cour/internal/store/sqlcgen"
)

type listHandlers struct {
	svc *lists.Service
	log *slog.Logger
}

var validListStatuses = map[apigen.ListStatus]sqlcgen.ListStatus{
	apigen.ListStatusWatching:  sqlcgen.ListStatusWatching,
	apigen.ListStatusCompleted: sqlcgen.ListStatusCompleted,
	apigen.ListStatusPlanning:  sqlcgen.ListStatusPlanning,
	apigen.ListStatusPaused:    sqlcgen.ListStatusPaused,
	apigen.ListStatusDropped:   sqlcgen.ListStatusDropped,
}

func (h listHandlers) GetMyList(w http.ResponseWriter, r *http.Request, params apigen.GetMyListParams) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	var status *sqlcgen.ListStatus
	if params.Status != nil {
		s, valid := validListStatuses[*params.Status]
		if !valid {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "unknown status")
			return
		}
		status = &s
	}

	rows, err := h.svc.ListFor(r.Context(), id.UserID, status)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.ListEntryWithAnime, len(rows))
	for i, row := range rows {
		data[i] = apigen.ListEntryWithAnime{
			AnimeId:    row.ListEntry.AnimeID,
			Status:     apigen.ListStatus(row.ListEntry.Status),
			Score:      toIntFrom16(row.ListEntry.Score),
			Progress:   int(row.ListEntry.Progress),
			StartedOn:  toDate(row.ListEntry.StartedOn),
			FinishedOn: toDate(row.ListEntry.FinishedOn),
			UpdatedAt:  row.ListEntry.UpdatedAt,
			Anime:      toSummary(row.Anime),
		}
	}
	writeJSON(w, http.StatusOK, apigen.MyList{Data: data})
}

func (h listHandlers) GetMyListEntry(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	entry, err := h.svc.Entry(r.Context(), id.UserID, animeID)
	if err != nil {
		if errors.Is(err, lists.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toListEntry(entry))
}

func (h listHandlers) UpsertMyListEntry(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.UpsertListEntryRequest](w, r)
	if !ok {
		return
	}

	status, valid := validListStatuses[req.Status]
	if !valid {
		writeValidation(w, map[string]string{"status": "unknown status"})
		return
	}
	in := lists.UpsertInput{Status: status}

	if req.Score != nil {
		if *req.Score < 0 || *req.Score > 10 {
			writeValidation(w, map[string]string{"score": "must be between 1 and 10 (0 clears)"})
			return
		}
		v := int16(*req.Score)
		in.Score = &v
	}
	if req.Progress != nil {
		if *req.Progress < 0 {
			writeValidation(w, map[string]string{"progress": "must be at least 0"})
			return
		}
		v := int32(*req.Progress)
		in.Progress = &v
	}
	if req.StartedOn != nil {
		in.StartedOn = &req.StartedOn.Time
	}
	if req.FinishedOn != nil {
		in.FinishedOn = &req.FinishedOn.Time
	}

	entry, err := h.svc.Upsert(r.Context(), id.UserID, animeID, in)
	if err != nil {
		if errors.Is(err, lists.ErrAnimeNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toListEntry(entry))
}

func (h listHandlers) DeleteMyListEntry(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if err := h.svc.Remove(r.Context(), id.UserID, animeID); err != nil {
		if errors.Is(err, lists.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h listHandlers) GetMyFavorites(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	rows, err := h.svc.Favorites(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.AnimeSummary, len(rows))
	for i, row := range rows {
		data[i] = toSummary(row.Anime)
	}
	writeJSON(w, http.StatusOK, apigen.FavoritesList{Data: data})
}

func (h listHandlers) GetFavoriteState(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	fav, err := h.svc.IsFavorite(r.Context(), id.UserID, animeID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, apigen.FavoriteState{Favorited: fav})
}

func (h listHandlers) AddFavorite(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if err := h.svc.Favorite(r.Context(), id.UserID, animeID); err != nil {
		if errors.Is(err, lists.ErrAnimeNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h listHandlers) RemoveFavorite(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if err := h.svc.Unfavorite(r.Context(), id.UserID, animeID); err != nil {
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── DTO helpers ────────────────────────────────────────────────────────────

func toListEntry(e sqlcgen.ListEntry) apigen.ListEntry {
	return apigen.ListEntry{
		AnimeId:    e.AnimeID,
		Status:     apigen.ListStatus(e.Status),
		Score:      toIntFrom16(e.Score),
		Progress:   int(e.Progress),
		StartedOn:  toDate(e.StartedOn),
		FinishedOn: toDate(e.FinishedOn),
		UpdatedAt:  e.UpdatedAt,
	}
}

func toIntFrom16(v *int16) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

func toDate(t *time.Time) *types.Date {
	if t == nil {
		return nil
	}
	return &types.Date{Time: *t}
}
