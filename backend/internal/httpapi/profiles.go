package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"cour/internal/httpapi/apigen"
	"cour/internal/profiles"
	"cour/internal/store/sqlcgen"
)

type profileHandlers struct {
	svc *profiles.Service
	log *slog.Logger
}

// Same bare-constant caveat as validListStatuses (see lists.go).
var validFormats = map[apigen.Format]sqlcgen.AnimeFormat{
	apigen.TV:      sqlcgen.AnimeFormatTV,
	apigen.TVSHORT: sqlcgen.AnimeFormatTVSHORT,
	apigen.MOVIE:   sqlcgen.AnimeFormatMOVIE,
	apigen.SPECIAL: sqlcgen.AnimeFormatSPECIAL,
	apigen.OVA:     sqlcgen.AnimeFormatOVA,
	apigen.ONA:     sqlcgen.AnimeFormatONA,
	apigen.MUSIC:   sqlcgen.AnimeFormatMUSIC,
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
	genres := make([]apigen.GenreStat, len(p.Genres))
	for i, g := range p.Genres {
		genres[i] = apigen.GenreStat{
			Genre:      g.Genre,
			Count:      int(g.Count),
			RatedCount: int(g.RatedCount),
		}
		if g.RatedCount > 0 {
			v := float32(g.MeanScore)
			genres[i].MeanScore = &v
		}
	}

	seasonCounts := make([]apigen.SeasonCount, len(p.SeasonCounts))
	for i, s := range p.SeasonCounts {
		seasonCounts[i] = apigen.SeasonCount{Year: int(s.Year), Count: int(s.Count)}
	}
	formatCounts := make([]apigen.FormatCount, len(p.FormatCounts))
	for i, f := range p.FormatCounts {
		formatCounts[i] = apigen.FormatCount{Format: apigen.Format(f.Format), Count: int(f.Count)}
	}
	topStudios := make([]apigen.StudioCount, len(p.TopStudios))
	for i, s := range p.TopStudios {
		topStudios[i] = apigen.StudioCount{Name: s.Name, Count: int(s.Count)}
	}

	var meanScore *float32
	if p.RatedCount > 0 {
		v := float32(p.MeanScore)
		meanScore = &v
	}
	var scoreStddev *float32
	if p.ScoreStddev != nil {
		v := float32(*p.ScoreStddev)
		scoreStddev = &v
	}
	var scoreBias *apigen.ScoreBias
	if p.ScoreBias != nil {
		scoreBias = &apigen.ScoreBias{
			UserMean:      float32(p.ScoreBias.UserMean),
			CommunityMean: float32(p.ScoreBias.CommunityMean),
			SampleSize:    int(p.ScoreBias.SampleSize),
		}
	}
	var longestCompleted *apigen.AnimeSummary
	if p.LongestCompleted != nil {
		v := toSummary(*p.LongestCompleted)
		longestCompleted = &v
	}
	var librarySpan *apigen.LibrarySpan
	if p.LibrarySpan != nil {
		librarySpan = &apigen.LibrarySpan{
			EarliestYear: int(p.LibrarySpan.EarliestYear),
			LatestYear:   int(p.LibrarySpan.LatestYear),
		}
	}

	histogram := make([]struct {
		Count int `json:"count"`
		Score int `json:"score"`
	}, len(p.ScoreHistogram))
	for i, count := range p.ScoreHistogram {
		histogram[i].Score = i + 1
		histogram[i].Count = int(count)
	}

	var banner *apigen.ProfileBanner
	if p.Banner != nil {
		banner = &apigen.ProfileBanner{
			AnimeId:     p.Banner.AnimeID,
			BannerImage: p.Banner.BannerImage,
			CoverColor:  p.Banner.CoverColor,
		}
	}

	writeJSON(w, http.StatusOK, apigen.UserProfile{
		Username:       p.User.Username,
		AvatarUrl:      p.User.AvatarUrl,
		Bio:            p.User.Bio,
		FavoriteGenres: p.User.FavoriteGenres,
		Role:           apigen.Role(p.User.Role),
		CreatedAt:      p.User.CreatedAt,
		Banner:         banner,
		AccentColor:    p.User.AccentColor,
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
			MeanScore:        meanScore,
			RatedCount:       int(p.RatedCount),
			EpisodesWatched:  int(p.EpisodesWatched),
			WatchMinutes:     p.WatchMinutes,
			ScoreHistogram:   histogram,
			ScoreStddev:      scoreStddev,
			ScoreBias:        scoreBias,
			Genres:           genres,
			SeasonCounts:     seasonCounts,
			FormatCounts:     formatCounts,
			TopStudios:       topStudios,
			LongestCompleted: longestCompleted,
			LibrarySpan:      librarySpan,
		},
		Favorites:         favorites,
		CurrentlyWatching: watching,
	})
}

func (h profileHandlers) GetUserPublicList(w http.ResponseWriter, r *http.Request, username string, params apigen.GetUserPublicListParams) {
	q := profiles.PublicListQuery{Sort: "updated", Page: 1, PerPage: 50}
	if params.Status != nil {
		s, valid := validListStatuses[*params.Status]
		if !valid {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "unknown status")
			return
		}
		q.Status = &s
	}
	if params.Score != nil {
		if *params.Score < 1 || *params.Score > 10 {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "score must be between 1 and 10")
			return
		}
		v := int16(*params.Score)
		q.Score = &v
	}
	if params.Genre != nil {
		q.Genre = params.Genre
	}
	if params.Year != nil {
		if *params.Year < 1900 || *params.Year > 2200 {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "year out of range")
			return
		}
		v := int32(*params.Year) //nolint:gosec // bounded above
		q.Year = &v
	}
	if params.Format != nil {
		f, valid := validFormats[*params.Format]
		if !valid {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "unknown format")
			return
		}
		q.Format = &f
	}
	if params.Sort != nil {
		if !params.Sort.Valid() {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "unknown sort")
			return
		}
		q.Sort = string(*params.Sort)
	}
	if params.Page != nil {
		if *params.Page < 1 {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "page must be at least 1")
			return
		}
		q.Page = *params.Page
	}
	if params.PerPage != nil {
		if *params.PerPage < 1 || *params.PerPage > 50 {
			writeError(w, http.StatusBadRequest, CodeBadRequest, "per_page must be between 1 and 50")
			return
		}
		q.PerPage = *params.PerPage
	}

	page, err := h.svc.PublicList(r.Context(), username, q)
	if err != nil {
		if errors.Is(err, profiles.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}

	data := make([]apigen.ListEntryWithAnime, len(page.Rows))
	for i, row := range page.Rows {
		data[i] = toListEntryWithAnime(row.ListEntry, row.Anime)
	}
	writeJSON(w, http.StatusOK, apigen.UserList{
		Data:    data,
		Total:   int(page.Total),
		Page:    page.Page,
		PerPage: page.PerPage,
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
		BannerAnimeID:  req.BannerAnimeId,
		AccentColor:    req.AccentColor,
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
		if errors.Is(err, profiles.ErrBannerNotFound) {
			writeValidation(w, map[string]string{"banner_anime_id": "unknown anime"})
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toUserPrivate(user))
}
