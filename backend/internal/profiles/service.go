// Package profiles serves public user profiles (stats, favorites showcase,
// currently watching) and profile editing.
package profiles

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/cache"
	"cour/internal/store/sqlcgen"
)

var (
	ErrNotFound       = errors.New("profiles: user not found")
	ErrBannerNotFound = errors.New("profiles: banner anime not found")
)

const (
	profileTTL      = 5 * time.Minute
	showcaseLimit   = 12
	maxBioLen       = 500
	maxAvatarURLLen = 500
	maxGenres       = 10

	publicListMaxPerPage = 50
)

type Service struct {
	q     *sqlcgen.Queries
	cache *cache.Cache
	log   *slog.Logger
}

func New(pool *pgxpool.Pool, c *cache.Cache, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), cache: c, log: log}
}

// Banner is the owner's chosen banner anime, resolved to its art fields.
type Banner struct {
	AnimeID     int64
	BannerImage *string
	CoverColor  *string
}

// Profile is the public view: no email, no auth details.
type Profile struct {
	User              sqlcgen.User
	Banner            *Banner
	StatusCounts      map[string]int64
	MeanScore         float64
	RatedCount        int64
	EpisodesWatched   int64
	WatchMinutes      int64
	ScoreHistogram    [10]int64 // index i = count of entries scored i+1
	Genres            []sqlcgen.UserGenreBreakdownRow
	Favorites         []sqlcgen.ListFavoritesRow
	CurrentlyWatching []sqlcgen.UserCurrentlyWatchingRow
}

// v2: M3.5 added banner/histogram/watch-minutes — stale v1 JSON must miss.
func profileKey(username string) string { return "profile:v2:" + strings.ToLower(username) }

func (s *Service) ByUsername(ctx context.Context, username string) (Profile, error) {
	key := profileKey(username)
	var p Profile
	if found, err := s.cache.GetJSON(ctx, key, &p); err != nil {
		s.log.Warn("cache read failed", "key", key, "err", err)
	} else if found {
		return p, nil
	}

	user, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Profile{}, ErrNotFound
		}
		return Profile{}, fmt.Errorf("get user: %w", err)
	}

	counts, err := s.q.UserListStatusCounts(ctx, user.ID)
	if err != nil {
		return Profile{}, fmt.Errorf("status counts: %w", err)
	}
	scores, err := s.q.UserScoreStats(ctx, user.ID)
	if err != nil {
		return Profile{}, fmt.Errorf("score stats: %w", err)
	}
	episodes, err := s.q.UserEpisodesWatched(ctx, user.ID)
	if err != nil {
		return Profile{}, fmt.Errorf("episodes watched: %w", err)
	}
	genres, err := s.q.UserGenreBreakdown(ctx, user.ID)
	if err != nil {
		return Profile{}, fmt.Errorf("genre breakdown: %w", err)
	}
	favorites, err := s.q.ListFavorites(ctx, sqlcgen.ListFavoritesParams{UserID: user.ID, Limit: showcaseLimit})
	if err != nil {
		return Profile{}, fmt.Errorf("favorites: %w", err)
	}
	watching, err := s.q.UserCurrentlyWatching(ctx, user.ID)
	if err != nil {
		return Profile{}, fmt.Errorf("currently watching: %w", err)
	}
	hist, err := s.q.UserScoreHistogram(ctx, user.ID)
	if err != nil {
		return Profile{}, fmt.Errorf("score histogram: %w", err)
	}
	watchMinutes, err := s.q.UserWatchMinutes(ctx, user.ID)
	if err != nil {
		return Profile{}, fmt.Errorf("watch minutes: %w", err)
	}

	p = Profile{
		User:              user,
		StatusCounts:      map[string]int64{},
		MeanScore:         scores.MeanScore,
		RatedCount:        scores.RatedCount,
		EpisodesWatched:   episodes,
		WatchMinutes:      watchMinutes,
		Genres:            genres,
		Favorites:         favorites,
		CurrentlyWatching: watching,
	}
	for _, c := range counts {
		p.StatusCounts[string(c.Status)] = c.Count
	}
	for _, b := range hist {
		if b.Score >= 1 && b.Score <= 10 {
			p.ScoreHistogram[b.Score-1] = b.Count
		}
	}
	if user.BannerAnimeID != nil {
		// ON DELETE SET NULL keeps this fresh, but tolerate a miss anyway.
		banner, err := s.q.GetBannerAnime(ctx, *user.BannerAnimeID)
		switch {
		case err == nil:
			p.Banner = &Banner{AnimeID: banner.ID, BannerImage: banner.BannerImage, CoverColor: banner.CoverColor}
		case !errors.Is(err, pgx.ErrNoRows):
			return Profile{}, fmt.Errorf("banner anime: %w", err)
		}
	}

	if err := s.cache.SetJSON(ctx, key, p, profileTTL); err != nil {
		s.log.Warn("cache write failed", "key", key, "err", err)
	}
	return p, nil
}

type UpdateInput struct {
	Bio            *string
	AvatarURL      *string // nil = keep; pointer to "" = clear
	ClearAvatar    bool
	FavoriteGenres *[]string
	BannerAnimeID  *int64 // nil = keep; 0 = clear (the score-field convention)
}

// Validate returns per-field problems; empty map = valid.
func (in UpdateInput) Validate() map[string]string {
	problems := map[string]string{}
	if in.Bio != nil && len(*in.Bio) > maxBioLen {
		problems["bio"] = fmt.Sprintf("must be at most %d characters", maxBioLen)
	}
	if in.AvatarURL != nil && *in.AvatarURL != "" {
		u, err := url.Parse(*in.AvatarURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || len(*in.AvatarURL) > maxAvatarURLLen {
			problems["avatar_url"] = "must be an http(s) URL"
		}
	}
	if in.FavoriteGenres != nil && len(*in.FavoriteGenres) > maxGenres {
		problems["favorite_genres"] = fmt.Sprintf("at most %d genres", maxGenres)
	}
	return problems
}

func (s *Service) Update(ctx context.Context, userID int64, in UpdateInput) (sqlcgen.User, error) {
	current, err := s.q.GetUser(ctx, userID)
	if err != nil {
		return sqlcgen.User{}, fmt.Errorf("get user: %w", err)
	}

	bio := current.Bio
	if in.Bio != nil {
		bio = strings.TrimSpace(*in.Bio)
	}
	avatar := current.AvatarUrl
	switch {
	case in.ClearAvatar:
		avatar = nil
	case in.AvatarURL != nil && *in.AvatarURL != "":
		avatar = in.AvatarURL
	}
	genres := current.FavoriteGenres
	if in.FavoriteGenres != nil {
		genres = *in.FavoriteGenres
	}
	banner := current.BannerAnimeID
	switch {
	case in.BannerAnimeID == nil:
		// keep
	case *in.BannerAnimeID == 0:
		banner = nil
	default:
		// Existence check buys a clean validation error instead of an FK 500.
		if _, err := s.q.GetBannerAnime(ctx, *in.BannerAnimeID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sqlcgen.User{}, ErrBannerNotFound
			}
			return sqlcgen.User{}, fmt.Errorf("banner anime: %w", err)
		}
		banner = in.BannerAnimeID
	}

	user, err := s.q.UpdateProfile(ctx, sqlcgen.UpdateProfileParams{
		ID:             userID,
		Bio:            bio,
		AvatarUrl:      avatar,
		FavoriteGenres: genres,
		BannerAnimeID:  banner,
	})
	if err != nil {
		return sqlcgen.User{}, fmt.Errorf("update profile: %w", err)
	}

	if err := s.cache.Delete(ctx, profileKey(user.Username)); err != nil {
		s.log.Warn("cache invalidate failed", "err", err)
	}
	return user, nil
}

// PublicListQuery filters one page of a user's public library.
type PublicListQuery struct {
	Status  *sqlcgen.ListStatus
	Score   *int16
	Genre   *string
	Sort    string // updated | score | title
	Page    int
	PerPage int
}

type PublicListPage struct {
	Rows    []sqlcgen.UserPublicListRow
	Total   int64
	Page    int
	PerPage int
}

// PublicList serves the profile's library tabs. Uncached: it is one indexed
// query per request, and staleness here (an entry just moved status) would
// read as a bug next to the live tabs. A page past the end returns an empty
// page with total 0 — the count window only exists on returned rows, and
// clients never page past what page 1's total told them exists.
func (s *Service) PublicList(ctx context.Context, username string, q PublicListQuery) (PublicListPage, error) {
	user, err := s.q.GetUserByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PublicListPage{}, ErrNotFound
		}
		return PublicListPage{}, fmt.Errorf("get user: %w", err)
	}

	if q.Page < 1 {
		q.Page = 1
	}
	if q.PerPage < 1 || q.PerPage > publicListMaxPerPage {
		q.PerPage = publicListMaxPerPage
	}
	switch q.Sort {
	case "updated", "score", "title":
	default:
		q.Sort = "updated"
	}

	rows, err := s.q.UserPublicList(ctx, sqlcgen.UserPublicListParams{
		UserID:     user.ID,
		Status:     q.Status,
		Score:      q.Score,
		Genre:      q.Genre,
		Sort:       q.Sort,
		PageLimit:  int32(q.PerPage),                //nolint:gosec // clamped above
		PageOffset: int32((q.Page - 1) * q.PerPage), //nolint:gosec // clamped above
	})
	if err != nil {
		return PublicListPage{}, fmt.Errorf("public list: %w", err)
	}

	page := PublicListPage{Rows: rows, Page: q.Page, PerPage: q.PerPage}
	if len(rows) > 0 {
		page.Total = rows[0].Total
	}
	return page, nil
}
