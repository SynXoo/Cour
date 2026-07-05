package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"cour/internal/catalog"
	"cour/internal/httpapi/apigen"
)

const (
	defaultPerPage = 24
	maxPerPage     = 50
	searchLimit    = 50
)

// catalogHandlers implements the catalog portion of apigen.ServerInterface.
type catalogHandlers struct {
	svc *catalog.Service
	log *slog.Logger
}

// ListAnime handles both search (q present) and filtered browse.
func (h catalogHandlers) ListAnime(w http.ResponseWriter, r *http.Request, params apigen.ListAnimeParams) {
	page, per := 1, defaultPerPage
	if params.Page != nil && *params.Page > 0 {
		page = *params.Page
	}
	if params.PerPage != nil && *params.PerPage > 0 && *params.PerPage <= maxPerPage {
		per = *params.PerPage
	}

	if params.Q != nil && strings.TrimSpace(*params.Q) != "" {
		results, err := h.svc.Search(r.Context(), strings.TrimSpace(*params.Q), searchLimit)
		if err != nil {
			writeInternal(w, h.log, err)
			return
		}
		writeJSON(w, http.StatusOK, apigen.AnimeList{
			Data: toSummaries(results),
			Page: apigen.PageInfo{Page: 1, PerPage: len(results), HasMore: false},
		})
		return
	}

	filters := catalog.BrowseFilters{
		Genre: params.Genre,
		Year:  params.Year,
		Page:  page,
		Per:   per,
	}
	if params.Season != nil {
		filters.Season = ptrString(string(*params.Season))
	}
	if params.Status != nil {
		filters.Status = ptrString(string(*params.Status))
	}

	rows, hasMore, err := h.svc.Browse(r.Context(), filters)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, apigen.AnimeList{
		Data: toSummaries(rows),
		Page: apigen.PageInfo{Page: page, PerPage: per, HasMore: hasMore},
	})
}

func (h catalogHandlers) GetAnime(w http.ResponseWriter, r *http.Request, id int64) {
	d, err := h.svc.Detail(r.Context(), id)
	if err != nil {
		if errors.Is(err, catalog.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toDetail(d))
}

func (h catalogHandlers) GetSeason(w http.ResponseWriter, r *http.Request, year int, season apigen.Season) {
	list, err := h.svc.Season(r.Context(), year, string(season))
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, apigen.SeasonChart{
		Season: season,
		Year:   year,
		Data:   toSummaries(list),
	})
}

func (h catalogHandlers) GetSchedule(w http.ResponseWriter, r *http.Request, params apigen.GetScheduleParams) {
	from := time.Now().UTC()
	to := from.Add(7 * 24 * time.Hour)
	if params.From != nil {
		from = params.From.UTC()
	}
	if params.To != nil {
		to = params.To.UTC()
	}

	items, err := h.svc.Schedule(r.Context(), from, to)
	if err != nil {
		if errors.Is(err, catalog.ErrBadWindow) {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "schedule window must end after it starts")
			return
		}
		writeInternal(w, h.log, err)
		return
	}

	entries := make([]apigen.ScheduleEntry, 0, len(items))
	for _, it := range items {
		if it.Episode.AiringAt == nil {
			continue
		}
		entries = append(entries, apigen.ScheduleEntry{
			Anime:    toSummary(it.Anime),
			Episode:  int(it.Episode.Number),
			AiringAt: *it.Episode.AiringAt,
		})
	}
	writeJSON(w, http.StatusOK, apigen.ScheduleList{Data: entries})
}

func ptrString(s string) *string { return &s }
