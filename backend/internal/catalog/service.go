// Package catalog serves the anime catalog: detail, seasonal charts, browse,
// search, and the airing schedule — with Redis cache-aside on the hot reads.
package catalog

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"cour/internal/cache"
	"cour/internal/store/sqlcgen"
)

var ErrNotFound = errors.New("catalog: not found")

const (
	detailTTL   = time.Hour
	seasonTTL   = 6 * time.Hour
	scheduleTTL = 6 * time.Hour

	seasonChartLimit = 500
	maxScheduleSpan  = 14 * 24 * time.Hour
)

type Service struct {
	q     *sqlcgen.Queries
	cache *cache.Cache
	log   *slog.Logger
}

func New(q *sqlcgen.Queries, c *cache.Cache, log *slog.Logger) *Service {
	return &Service{q: q, cache: c, log: log}
}

// Detail is the cached unit for an anime page: the row plus its episodes.
type Detail struct {
	Anime    sqlcgen.Anime
	Episodes []sqlcgen.Episode
}

func (s *Service) Detail(ctx context.Context, id int64) (Detail, error) {
	key := cache.KeyAnime(id)
	var d Detail
	if found, err := s.cache.GetJSON(ctx, key, &d); err != nil {
		s.log.Warn("cache read failed", "key", key, "err", err)
	} else if found {
		return d, nil
	}

	a, err := s.q.GetAnime(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, fmt.Errorf("get anime %d: %w", id, err)
	}
	eps, err := s.q.ListEpisodes(ctx, id)
	if err != nil {
		return Detail{}, fmt.Errorf("list episodes %d: %w", id, err)
	}

	d = Detail{Anime: a, Episodes: eps}
	if err := s.cache.SetJSON(ctx, key, d, detailTTL); err != nil {
		s.log.Warn("cache write failed", "key", key, "err", err)
	}
	return d, nil
}

func (s *Service) Season(ctx context.Context, year int, season string) ([]sqlcgen.Anime, error) {
	key := cache.KeySeason(year, season)
	var list []sqlcgen.Anime
	if found, err := s.cache.GetJSON(ctx, key, &list); err != nil {
		s.log.Warn("cache read failed", "key", key, "err", err)
	} else if found {
		return list, nil
	}

	list, err := s.q.ListSeason(ctx, sqlcgen.ListSeasonParams{
		Season:     ptr(sqlcgen.AnimeSeason(season)),
		SeasonYear: ptrInt32(int32(year)),
		Limit:      seasonChartLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("list season %s %d: %w", season, year, err)
	}
	if err := s.cache.SetJSON(ctx, key, list, seasonTTL); err != nil {
		s.log.Warn("cache write failed", "key", key, "err", err)
	}
	return list, nil
}

type BrowseFilters struct {
	Genre  *string
	Year   *int
	Season *string
	Status *string
	Page   int
	Per    int
}

// Browse returns one page plus a has-more flag (fetches one extra row).
func (s *Service) Browse(ctx context.Context, f BrowseFilters) ([]sqlcgen.Anime, bool, error) {
	params := sqlcgen.BrowseAnimeParams{
		Limit:  int32(f.Per) + 1,
		Offset: int32((f.Page - 1) * f.Per),
		Genre:  f.Genre,
	}
	if f.Year != nil {
		params.SeasonYear = ptrInt32(int32(*f.Year))
	}
	if f.Season != nil {
		params.Season = ptr(sqlcgen.AnimeSeason(*f.Season))
	}
	if f.Status != nil {
		params.Status = ptr(sqlcgen.AnimeStatus(*f.Status))
	}

	rows, err := s.q.BrowseAnime(ctx, params)
	if err != nil {
		return nil, false, fmt.Errorf("browse: %w", err)
	}
	hasMore := len(rows) > f.Per
	if hasMore {
		rows = rows[:f.Per]
	}
	return rows, hasMore, nil
}

func (s *Service) Search(ctx context.Context, query string, limit int) ([]sqlcgen.Anime, error) {
	rows, err := s.q.SearchAnime(ctx, sqlcgen.SearchAnimeParams{Query: query, Limit: int32(limit)})
	if err != nil {
		return nil, fmt.Errorf("search %q: %w", query, err)
	}
	out := make([]sqlcgen.Anime, len(rows))
	for i, r := range rows {
		out[i] = r.Anime
	}
	return out, nil
}

// ScheduleItem pairs an episode with its anime for the weekly hub.
type ScheduleItem struct {
	Episode sqlcgen.Episode
	Anime   sqlcgen.Anime
}

func (s *Service) Schedule(ctx context.Context, from, to time.Time) ([]ScheduleItem, error) {
	if !to.After(from) {
		return nil, fmt.Errorf("%w: schedule window must end after it starts", ErrBadWindow)
	}
	if to.Sub(from) > maxScheduleSpan {
		to = from.Add(maxScheduleSpan)
	}

	key := s.cache.KeySchedule(ctx, from, to)
	var items []ScheduleItem
	if found, err := s.cache.GetJSON(ctx, key, &items); err != nil {
		s.log.Warn("cache read failed", "key", key, "err", err)
	} else if found {
		return items, nil
	}

	rows, err := s.q.ListAiringBetween(ctx, sqlcgen.ListAiringBetweenParams{
		AiringAt:   &from,
		AiringAt_2: &to,
	})
	if err != nil {
		return nil, fmt.Errorf("schedule %s..%s: %w", from, to, err)
	}
	items = make([]ScheduleItem, len(rows))
	for i, r := range rows {
		items[i] = ScheduleItem{Episode: r.Episode, Anime: r.Anime}
	}
	if err := s.cache.SetJSON(ctx, key, items, scheduleTTL); err != nil {
		s.log.Warn("cache write failed", "key", key, "err", err)
	}
	return items, nil
}

var ErrBadWindow = errors.New("catalog: bad window")

func ptr[T any](v T) *T { return &v }

func ptrInt32(v int32) *int32 { return &v }
