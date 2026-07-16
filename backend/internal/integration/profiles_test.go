//go:build integration

package integration

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProfileRevamp covers the M3.5 API deltas end to end: histogram +
// watch-minutes stats, the banner pick/clear/validate lifecycle, and the
// public paginated list.
func TestProfileRevamp(t *testing.T) {
	ctx := context.Background()

	bannerShow := seedAnime(t, 910001, "Banner Show", "Banner Show", 12)
	plainShow := seedAnime(t, 910002, "Aardvark Adventures", "Aardvark Adventures", 24)

	// seedAnime goes through the AniList sync path, which doesn't carry
	// banner/duration in the fixture literal above — dress the rows directly.
	_, err := testPool.Exec(ctx,
		`UPDATE anime SET banner_image = 'https://img.test/banner.jpg', cover_color = '#e4a15d', duration_min = 24 WHERE id = $1`,
		bannerShow)
	require.NoError(t, err)
	_, err = testPool.Exec(ctx, `UPDATE anime SET duration_min = 20 WHERE id = $1`, plainShow)
	require.NoError(t, err)

	c := newClient(t)
	c.register("profileuser")

	status := c.do(http.MethodPut, "/api/v1/me/list/"+itoa(bannerShow), map[string]any{
		"status": "completed", "score": 8, "progress": 12,
	}, nil)
	require.Equal(t, http.StatusOK, status)
	status = c.do(http.MethodPut, "/api/v1/me/list/"+itoa(plainShow), map[string]any{
		"status": "watching", "score": 6, "progress": 5,
	}, nil)
	require.Equal(t, http.StatusOK, status)

	type profileResp struct {
		Banner *struct {
			AnimeID     int64   `json:"anime_id"`
			BannerImage *string `json:"banner_image"`
			CoverColor  *string `json:"cover_color"`
		} `json:"banner"`
		Stats struct {
			WatchMinutes   int64 `json:"watch_minutes"`
			ScoreHistogram []struct {
				Score int `json:"score"`
				Count int `json:"count"`
			} `json:"score_histogram"`
		} `json:"stats"`
	}

	// Stats arrive zero-filled and summed; no banner until one is picked.
	var prof profileResp
	status = c.do(http.MethodGet, "/api/v1/users/profileuser", nil, &prof)
	require.Equal(t, http.StatusOK, status)
	assert.Nil(t, prof.Banner)
	assert.EqualValues(t, 12*24+5*20, prof.Stats.WatchMinutes)
	require.Len(t, prof.Stats.ScoreHistogram, 10, "all ten buckets, zeros included")
	for _, b := range prof.Stats.ScoreHistogram {
		switch b.Score {
		case 6, 8:
			assert.Equal(t, 1, b.Count, "score %d", b.Score)
		default:
			assert.Zero(t, b.Count, "score %d", b.Score)
		}
	}

	// Banner lifecycle: set → resolved art comes back (cache must bust)…
	status = c.do(http.MethodPatch, "/api/v1/me/profile", map[string]any{"banner_anime_id": bannerShow}, nil)
	require.Equal(t, http.StatusOK, status)
	prof = profileResp{}
	status = c.do(http.MethodGet, "/api/v1/users/profileuser", nil, &prof)
	require.Equal(t, http.StatusOK, status)
	require.NotNil(t, prof.Banner)
	assert.Equal(t, bannerShow, prof.Banner.AnimeID)
	require.NotNil(t, prof.Banner.BannerImage)
	assert.Equal(t, "https://img.test/banner.jpg", *prof.Banner.BannerImage)
	require.NotNil(t, prof.Banner.CoverColor)
	assert.Equal(t, "#e4a15d", *prof.Banner.CoverColor)

	// …an unknown anime is a validation error, not a 500…
	status = c.do(http.MethodPatch, "/api/v1/me/profile", map[string]any{"banner_anime_id": 999999999}, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, status)

	// …and 0 clears the pick.
	status = c.do(http.MethodPatch, "/api/v1/me/profile", map[string]any{"banner_anime_id": 0}, nil)
	require.Equal(t, http.StatusOK, status)
	prof = profileResp{}
	c.do(http.MethodGet, "/api/v1/users/profileuser", nil, &prof)
	assert.Nil(t, prof.Banner)
}

// TestProfileTasteStats covers the M3.6 deltas: the derived taste statistics,
// the accent lifecycle, and the era/format filters they click through to.
func TestProfileTasteStats(t *testing.T) {
	ctx := context.Background()

	// Five rated shows is exactly minBiasSample, so the bias must appear; the
	// community sits at 90/80/80/80/80 = 82% → 8.2, the user at 6.0 → harsh.
	ids := make([]int64, 0, 6)
	for i := range 5 {
		ids = append(ids, seedAnime(t, 920100+i, "Taste "+itoa(int64(i)), "Taste "+itoa(int64(i)), 12))
	}
	movie := seedAnime(t, 920200, "Taste Movie", "Taste Movie", 1)
	ids = append(ids, movie)

	for i, id := range ids[:5] {
		score := 90
		if i > 0 {
			score = 80
		}
		// seedAnime's fixture carries no format, score, or studios.
		_, err := testPool.Exec(ctx,
			`UPDATE anime SET format = 'TV', average_score = $2, duration_min = 24, season_year = $3,
			 studios = '[{"name":"bones","is_main":true},{"name":"Aniplex","is_main":false}]'::jsonb
			 WHERE id = $1`, id, score, 2019+i)
		require.NoError(t, err)
	}
	// The movie is a different format and a different era, and carries no
	// community score — so it must sit out the bias entirely.
	_, err := testPool.Exec(ctx,
		`UPDATE anime SET format = 'MOVIE', average_score = NULL, season_year = 2007, duration_min = 120 WHERE id = $1`, movie)
	require.NoError(t, err)

	c := newClient(t)
	c.register("tasteuser")

	for _, id := range ids[:5] {
		status := c.do(http.MethodPut, "/api/v1/me/list/"+itoa(id), map[string]any{
			"status": "completed", "score": 6, "progress": 12,
		}, nil)
		require.Equal(t, http.StatusOK, status)
	}
	status := c.do(http.MethodPut, "/api/v1/me/list/"+itoa(movie), map[string]any{
		"status": "dropped", "score": 6, "progress": 1,
	}, nil)
	require.Equal(t, http.StatusOK, status)

	type tasteResp struct {
		AccentColor *string `json:"accent_color"`
		Stats       struct {
			ScoreStddev *float64 `json:"score_stddev"`
			ScoreBias   *struct {
				UserMean      float64 `json:"user_mean"`
				CommunityMean float64 `json:"community_mean"`
				SampleSize    int     `json:"sample_size"`
			} `json:"score_bias"`
			Genres []struct {
				Genre      string   `json:"genre"`
				Count      int      `json:"count"`
				MeanScore  *float64 `json:"mean_score"`
				RatedCount int      `json:"rated_count"`
			} `json:"genres"`
			SeasonCounts []struct {
				Year  int `json:"year"`
				Count int `json:"count"`
			} `json:"season_counts"`
			FormatCounts []struct {
				Format string `json:"format"`
				Count  int    `json:"count"`
			} `json:"format_counts"`
			TopStudios []struct {
				Name  string `json:"name"`
				Count int    `json:"count"`
			} `json:"top_studios"`
			LongestCompleted *struct {
				ID int64 `json:"id"`
			} `json:"longest_completed"`
			LibrarySpan *struct {
				EarliestYear int `json:"earliest_year"`
				LatestYear   int `json:"latest_year"`
			} `json:"library_span"`
		} `json:"stats"`
	}

	var prof tasteResp
	status = c.do(http.MethodGet, "/api/v1/users/tasteuser", nil, &prof)
	require.Equal(t, http.StatusOK, status)

	// Bias: only the five shows with a community score take part.
	require.NotNil(t, prof.Stats.ScoreBias)
	assert.Equal(t, 5, prof.Stats.ScoreBias.SampleSize)
	assert.InDelta(t, 6.0, prof.Stats.ScoreBias.UserMean, 0.001)
	assert.InDelta(t, 8.2, prof.Stats.ScoreBias.CommunityMean, 0.001)

	// Every score is a 6, so the scale is never stretched.
	require.NotNil(t, prof.Stats.ScoreStddev)
	assert.InDelta(t, 0.0, *prof.Stats.ScoreStddev, 0.001)

	// Eras count completed shows only — the dropped movie's 2007 stays out.
	require.Len(t, prof.Stats.SeasonCounts, 5)
	assert.Equal(t, 2019, prof.Stats.SeasonCounts[0].Year, "ascending")
	assert.Equal(t, 2023, prof.Stats.SeasonCounts[4].Year)

	// …but the span covers the whole shelf, dropped included.
	require.NotNil(t, prof.Stats.LibrarySpan)
	assert.Equal(t, 2007, prof.Stats.LibrarySpan.EarliestYear)
	assert.Equal(t, 2023, prof.Stats.LibrarySpan.LatestYear)

	// Formats: 5 TV, 1 movie, largest first.
	require.Len(t, prof.Stats.FormatCounts, 2)
	assert.Equal(t, "TV", prof.Stats.FormatCounts[0].Format)
	assert.Equal(t, 5, prof.Stats.FormatCounts[0].Count)
	assert.Equal(t, "MOVIE", prof.Stats.FormatCounts[1].Format)

	// Only main studios: the licensor on every row must not win.
	require.NotEmpty(t, prof.Stats.TopStudios)
	assert.Equal(t, "bones", prof.Stats.TopStudios[0].Name)
	assert.Equal(t, 5, prof.Stats.TopStudios[0].Count)

	// Longest *completed* — the 1-episode movie was dropped, not finished.
	require.NotNil(t, prof.Stats.LongestCompleted)
	assert.Contains(t, ids[:5], prof.Stats.LongestCompleted.ID)

	require.NotEmpty(t, prof.Stats.Genres)
	assert.Equal(t, "Action", prof.Stats.Genres[0].Genre)
	require.NotNil(t, prof.Stats.Genres[0].MeanScore)
	assert.InDelta(t, 6.0, *prof.Stats.Genres[0].MeanScore, 0.001)
	assert.Equal(t, 6, prof.Stats.Genres[0].RatedCount)

	// ── Accent lifecycle ────────────────────────────────────────────────
	assert.Nil(t, prof.AccentColor)

	// Uppercase in, lowercase out — the column's CHECK only accepts lowercase.
	status = c.do(http.MethodPatch, "/api/v1/me/profile", map[string]any{"accent_color": "#AABBCC"}, nil)
	require.Equal(t, http.StatusOK, status)
	prof = tasteResp{}
	status = c.do(http.MethodGet, "/api/v1/users/tasteuser", nil, &prof)
	require.Equal(t, http.StatusOK, status)
	require.NotNil(t, prof.AccentColor, "profile cache must have been busted")
	assert.Equal(t, "#aabbcc", *prof.AccentColor)

	// Garbage is a validation error, not a constraint-violation 500.
	status = c.do(http.MethodPatch, "/api/v1/me/profile", map[string]any{"accent_color": "rebeccapurple"}, nil)
	assert.Equal(t, http.StatusUnprocessableEntity, status)

	// Empty string clears it.
	status = c.do(http.MethodPatch, "/api/v1/me/profile", map[string]any{"accent_color": ""}, nil)
	require.Equal(t, http.StatusOK, status)
	prof = tasteResp{}
	c.do(http.MethodGet, "/api/v1/users/tasteuser", nil, &prof)
	assert.Nil(t, prof.AccentColor)

	// ── The filters those charts click through to ───────────────────────
	type listResp struct {
		Data []struct {
			Anime struct {
				ID int64 `json:"id"`
			} `json:"anime"`
		} `json:"data"`
		Total int `json:"total"`
	}
	anon := newClient(t)

	var page listResp
	status = anon.do(http.MethodGet, "/api/v1/users/tasteuser/list?year=2007", nil, &page)
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, 1, page.Total)
	assert.Equal(t, movie, page.Data[0].Anime.ID)

	page = listResp{}
	status = anon.do(http.MethodGet, "/api/v1/users/tasteuser/list?format=MOVIE", nil, &page)
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, 1, page.Total)
	assert.Equal(t, movie, page.Data[0].Anime.ID)

	// The era strip narrows to completed, which excludes the dropped movie.
	page = listResp{}
	status = anon.do(http.MethodGet, "/api/v1/users/tasteuser/list?year=2007&status=completed", nil, &page)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, 0, page.Total)

	page = listResp{}
	status = anon.do(http.MethodGet, "/api/v1/users/tasteuser/list?format=NOTAFORMAT", nil, &page)
	assert.Equal(t, http.StatusBadRequest, status)

	page = listResp{}
	status = anon.do(http.MethodGet, "/api/v1/users/tasteuser/list?year=1500", nil, &page)
	assert.Equal(t, http.StatusBadRequest, status)
}

func TestPublicListPagination(t *testing.T) {
	first := seedAnime(t, 910003, "Zeta Finale", "Zeta Finale", 12)
	second := seedAnime(t, 910004, "Beta Middle", "Beta Middle", 12)
	third := seedAnime(t, 910005, "Alpha Opener", "Alpha Opener", 12)

	c := newClient(t)
	c.register("publiclister")
	for id, body := range map[int64]map[string]any{
		first:  {"status": "completed", "score": 9},
		second: {"status": "completed", "score": 7},
		third:  {"status": "watching", "score": nil, "progress": 3},
	} {
		status := c.do(http.MethodPut, "/api/v1/me/list/"+itoa(id), body, nil)
		require.Equal(t, http.StatusOK, status)
	}

	type listResp struct {
		Data []struct {
			Status string `json:"status"`
			Score  *int   `json:"score"`
			Anime  struct {
				ID    int64  `json:"id"`
				Title string `json:"title"`
			} `json:"anime"`
		} `json:"data"`
		Total   int `json:"total"`
		Page    int `json:"page"`
		PerPage int `json:"per_page"`
	}

	// Anonymous — lists are public by default.
	anon := newClient(t)

	var page listResp
	status := anon.do(http.MethodGet, "/api/v1/users/publiclister/list?status=completed", nil, &page)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, 2, page.Total)
	require.Len(t, page.Data, 2)
	for _, e := range page.Data {
		assert.Equal(t, "completed", e.Status)
	}

	// Exact-score filter (the histogram click).
	page = listResp{}
	status = anon.do(http.MethodGet, "/api/v1/users/publiclister/list?score=9", nil, &page)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, page.Data, 1)
	assert.Equal(t, first, page.Data[0].Anime.ID)

	// Title sort walks alphabetically and pages tile without gaps or dupes.
	seen := []string{}
	for p := 1; p <= 2; p++ {
		page = listResp{}
		status = anon.do(http.MethodGet, "/api/v1/users/publiclister/list?sort=title&per_page=2&page="+itoa(int64(p)), nil, &page)
		require.Equal(t, http.StatusOK, status)
		assert.Equal(t, 3, page.Total)
		for _, e := range page.Data {
			seen = append(seen, e.Anime.Title)
		}
	}
	assert.Equal(t, []string{"Alpha Opener", "Beta Middle", "Zeta Finale"}, seen)

	// Score sort puts the 9 first and unrated last.
	page = listResp{}
	status = anon.do(http.MethodGet, "/api/v1/users/publiclister/list?sort=score", nil, &page)
	require.Equal(t, http.StatusOK, status)
	require.Len(t, page.Data, 3)
	assert.Equal(t, first, page.Data[0].Anime.ID)
	assert.Nil(t, page.Data[2].Score, "unrated sorts last")

	// Genre filter: seedAnime tags everything Action.
	page = listResp{}
	anon.do(http.MethodGet, "/api/v1/users/publiclister/list?genre=Action", nil, &page)
	assert.Equal(t, 3, page.Total)
	page = listResp{}
	anon.do(http.MethodGet, "/api/v1/users/publiclister/list?genre=Romance", nil, &page)
	assert.Zero(t, page.Total)

	// Unknown user is a 404.
	status = anon.do(http.MethodGet, "/api/v1/users/nobody_here/list", nil, nil)
	assert.Equal(t, http.StatusNotFound, status)
}
