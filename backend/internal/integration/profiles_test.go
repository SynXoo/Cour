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
