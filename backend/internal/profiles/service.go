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

var ErrNotFound = errors.New("profiles: user not found")

const (
	profileTTL      = 5 * time.Minute
	showcaseLimit   = 12
	maxBioLen       = 500
	maxAvatarURLLen = 500
	maxGenres       = 10
)

type Service struct {
	q     *sqlcgen.Queries
	cache *cache.Cache
	log   *slog.Logger
}

func New(pool *pgxpool.Pool, c *cache.Cache, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), cache: c, log: log}
}

// Profile is the public view: no email, no auth details.
type Profile struct {
	User              sqlcgen.User
	StatusCounts      map[string]int64
	MeanScore         float64
	RatedCount        int64
	EpisodesWatched   int64
	Genres            []sqlcgen.UserGenreBreakdownRow
	Favorites         []sqlcgen.ListFavoritesRow
	CurrentlyWatching []sqlcgen.UserCurrentlyWatchingRow
}

func profileKey(username string) string { return "profile:v1:" + strings.ToLower(username) }

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

	p = Profile{
		User:              user,
		StatusCounts:      map[string]int64{},
		MeanScore:         scores.MeanScore,
		RatedCount:        scores.RatedCount,
		EpisodesWatched:   episodes,
		Genres:            genres,
		Favorites:         favorites,
		CurrentlyWatching: watching,
	}
	for _, c := range counts {
		p.StatusCounts[string(c.Status)] = c.Count
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

	user, err := s.q.UpdateProfile(ctx, sqlcgen.UpdateProfileParams{
		ID:             userID,
		Bio:            bio,
		AvatarUrl:      avatar,
		FavoriteGenres: genres,
	})
	if err != nil {
		return sqlcgen.User{}, fmt.Errorf("update profile: %w", err)
	}

	if err := s.cache.Delete(ctx, profileKey(user.Username)); err != nil {
		s.log.Warn("cache invalidate failed", "err", err)
	}
	return user, nil
}
