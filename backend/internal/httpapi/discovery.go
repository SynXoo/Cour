package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"cour/internal/discovery"
	"cour/internal/httpapi/apigen"
)

type discoveryHandlers struct {
	svc *discovery.Service
	log *slog.Logger
}

func (h discoveryHandlers) GetTrending(w http.ResponseWriter, r *http.Request, params apigen.GetTrendingParams) {
	limit := 50
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 100 {
		limit = *params.Limit
	}
	list, computedAt, err := h.svc.Trending(r.Context(), limit)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	var at *time.Time
	if !computedAt.IsZero() {
		at = &computedAt
	}
	writeJSON(w, http.StatusOK, apigen.TrendingList{Data: toSummaries(list), ComputedAt: at})
}

func (h discoveryHandlers) GetHiddenGems(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.HiddenGems(r.Context())
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, apigen.DiscoveryList{Data: toSummaries(list)})
}

func (h discoveryHandlers) GetMyRecommendations(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	items, coldStart, err := h.svc.Recommendations(r.Context(), id.UserID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.RecommendationItem, len(items))
	for i, item := range items {
		data[i] = apigen.RecommendationItem{Anime: toSummary(item.Anime), Reasons: item.Reasons}
	}
	writeJSON(w, http.StatusOK, apigen.Recommendations{Data: data, ColdStart: coldStart})
}
