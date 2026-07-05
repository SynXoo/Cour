package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"cour/internal/httpapi/apigen"
	"cour/internal/profiles"
)

type profileHandlers struct {
	svc *profiles.Service
	log *slog.Logger
}

func (h profileHandlers) GetUserProfile(w http.ResponseWriter, r *http.Request, username string) {
	p, err := h.svc.ByUsername(r.Context(), username)
	if err != nil {
		if errors.Is(err, profiles.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}

	favorites := make([]apigen.AnimeSummary, len(p.Favorites))
	for i, f := range p.Favorites {
		favorites[i] = toSummary(f.Anime)
	}
	watching := make([]apigen.WatchingEntry, len(p.CurrentlyWatching))
	for i, wch := range p.CurrentlyWatching {
		watching[i] = apigen.WatchingEntry{Anime: toSummary(wch.Anime), Progress: int(wch.Progress)}
	}
	genres := make([]struct {
		Count int    `json:"count"`
		Genre string `json:"genre"`
	}, len(p.Genres))
	for i, g := range p.Genres {
		genres[i].Genre = g.Genre
		genres[i].Count = int(g.Count)
	}

	var meanScore *float32
	if p.RatedCount > 0 {
		v := float32(p.MeanScore)
		meanScore = &v
	}

	writeJSON(w, http.StatusOK, apigen.UserProfile{
		Username:       p.User.Username,
		AvatarUrl:      p.User.AvatarUrl,
		Bio:            p.User.Bio,
		FavoriteGenres: p.User.FavoriteGenres,
		Role:           apigen.Role(p.User.Role),
		CreatedAt:      p.User.CreatedAt,
		Stats: apigen.ProfileStats{
			Counts: struct {
				Completed int `json:"completed"`
				Dropped   int `json:"dropped"`
				Paused    int `json:"paused"`
				Planning  int `json:"planning"`
				Watching  int `json:"watching"`
			}{
				Watching:  int(p.StatusCounts["watching"]),
				Completed: int(p.StatusCounts["completed"]),
				Planning:  int(p.StatusCounts["planning"]),
				Paused:    int(p.StatusCounts["paused"]),
				Dropped:   int(p.StatusCounts["dropped"]),
			},
			MeanScore:       meanScore,
			RatedCount:      int(p.RatedCount),
			EpisodesWatched: int(p.EpisodesWatched),
			Genres:          genres,
		},
		Favorites:         favorites,
		CurrentlyWatching: watching,
	})
}

func (h profileHandlers) UpdateMyProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.UpdateProfileRequest](w, r)
	if !ok {
		return
	}

	in := profiles.UpdateInput{
		Bio:            req.Bio,
		FavoriteGenres: req.FavoriteGenres,
	}
	// Distinguish "avatar_url": null (clear) from omitted (keep): the field
	// is *string and nullable, so decode gives nil for both — re-check raw
	// presence is overkill here; the API contract says empty string also
	// clears, which the form uses.
	if req.AvatarUrl != nil {
		in.AvatarURL = req.AvatarUrl
	}
	if req.AvatarUrl != nil && *req.AvatarUrl == "" {
		in.ClearAvatar = true
	}

	if problems := in.Validate(); len(problems) > 0 {
		writeValidation(w, problems)
		return
	}

	user, err := h.svc.Update(r.Context(), id.UserID, in)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toUserPrivate(user))
}
