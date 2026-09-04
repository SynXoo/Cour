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

func (h discoveryHandlers) GetTrendingExplained(w http.ResponseWriter, r *http.Request, params apigen.GetTrendingExplainedParams) {
	limit := 12
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 30 {
		limit = *params.Limit
	}
	var userID *int64
	if id, ok := identity(r); ok {
		userID = &id.UserID
	}
	items, computedAt, err := h.svc.Explain(r.Context(), limit, userID)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.ExplainedTrending, len(items))
	for i, it := range items {
		data[i] = apigen.ExplainedTrending{
			Anime: toSummary(it.Anime),
			Rank:  it.Rank,
			Signals: apigen.TrendingSignals{
				Comments:  it.Signals.Comments,
				ListAdds:  it.Signals.ListAdds,
				Completed: it.Signals.Completed,
				Favorites: it.Signals.Favorites,
				Reviews:   it.Signals.Reviews,
				Scored:    it.Signals.Scored,
			},
		}
		if it.You != nil {
			you := apigen.TrendingYou{
				Followees:      it.You.Followees,
				FolloweesCount: it.You.FolloweesCount,
				SharedGenres:   it.You.SharedGenres,
			}
			if it.You.Status != nil {
				st := apigen.ListStatus(*it.You.Status)
				you.Status = &st
			}
			data[i].You = &you
		}
	}
	var at *time.Time
	if !computedAt.IsZero() {
		at = &computedAt
	}
	writeJSON(w, http.StatusOK, apigen.ExplainedTrendingList{Data: data, ComputedAt: at})
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
