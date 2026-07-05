package anilist

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"cour/internal/cache"
	"cour/internal/store/sqlcgen"
)

// Page sizes and caps keep a single sync bounded no matter what the upstream
// returns.
const (
	perPage        = 50
	maxSeasonPages = 8  // a season tops out around ~300 titles
	maxAiringPages = 24 // ~1200 schedule entries per window
)

type Syncer struct {
	client *Client
	q      *sqlcgen.Queries
	cache  *cache.Cache
	log    *slog.Logger
}

func NewSyncer(client *Client, q *sqlcgen.Queries, c *cache.Cache, log *slog.Logger) *Syncer {
	return &Syncer{client: client, q: q, cache: c, log: log}
}

// UpsertMedia writes a batch of media rows (idempotent), ensures episode
// stubs exist for counted shows, and invalidates per-anime caches.
// Returns anilist_id -> internal id for callers that need the mapping.
func (s *Syncer) UpsertMedia(ctx context.Context, items []Media) (map[int]int64, error) {
	ids := make(map[int]int64, len(items))
	for _, m := range items {
		if _, done := ids[m.ID]; done {
			continue
		}
		params, err := MapMedia(m)
		if err != nil {
			s.log.Warn("skipping unmappable media", "err", err)
			continue
		}
		id, err := s.q.UpsertAnime(ctx, params)
		if err != nil {
			return ids, fmt.Errorf("upsert anilist_id=%d: %w", m.ID, err)
		}
		ids[m.ID] = id

		status := params.Status
		if m.Episodes != nil && *m.Episodes > 0 &&
			(status == sqlcgen.AnimeStatusFINISHED || status == sqlcgen.AnimeStatusRELEASING) {
			if err := s.q.EnsureEpisodes(ctx, sqlcgen.EnsureEpisodesParams{
				AnimeID: id,
				Column2: int32(*m.Episodes),
			}); err != nil {
				return ids, fmt.Errorf("ensure episodes anilist_id=%d: %w", m.ID, err)
			}
		}
		if err := s.cache.Delete(ctx, cache.KeyAnime(id)); err != nil {
			s.log.Warn("cache invalidate failed", "err", err)
		}
	}
	return ids, nil
}

// SyncSeason mirrors one season's chart.
func (s *Syncer) SyncSeason(ctx context.Context, season string, year int) (int, error) {
	total := 0
	for page := 1; page <= maxSeasonPages; page++ {
		media, hasNext, err := s.client.SeasonPage(ctx, season, year, page, perPage)
		if err != nil {
			return total, fmt.Errorf("season %s %d page %d: %w", season, year, page, err)
		}
		ids, err := s.UpsertMedia(ctx, media)
		if err != nil {
			return total, err
		}
		total += len(ids)
		if !hasNext {
			break
		}
	}
	if err := s.cache.Delete(ctx, cache.KeySeason(year, season)); err != nil {
		s.log.Warn("cache invalidate failed", "err", err)
	}
	s.log.Info("season synced", "season", season, "year", year, "titles", total)
	return total, nil
}

// SyncTrendingUpstream refreshes AniList's own trending signal (blended into
// Cour's trending score) and keeps globally popular titles fresh.
func (s *Syncer) SyncTrendingUpstream(ctx context.Context) (int, error) {
	total := 0
	for page := 1; page <= 2; page++ {
		media, hasNext, err := s.client.TrendingPage(ctx, page, perPage)
		if err != nil {
			return total, fmt.Errorf("trending page %d: %w", page, err)
		}
		ids, err := s.UpsertMedia(ctx, media)
		if err != nil {
			return total, err
		}
		total += len(ids)
		if !hasNext {
			break
		}
	}
	s.log.Info("upstream trending synced", "titles", total)
	return total, nil
}

// SyncAiring mirrors the airing schedule for a time window, creating episode
// rows with air times.
func (s *Syncer) SyncAiring(ctx context.Context, from, to time.Time) (int, error) {
	total := 0
	for page := 1; page <= maxAiringPages; page++ {
		schedules, hasNext, err := s.client.AiringPage(ctx, from, to, page)
		if err != nil {
			return total, fmt.Errorf("airing page %d: %w", page, err)
		}

		media := make([]Media, 0, len(schedules))
		for _, sc := range schedules {
			media = append(media, sc.Media)
		}
		ids, err := s.UpsertMedia(ctx, media)
		if err != nil {
			return total, err
		}

		for _, sc := range schedules {
			animeID, ok := ids[sc.Media.ID]
			if !ok {
				continue // unmappable media was skipped
			}
			if err := s.upsertEpisodeAiring(ctx, animeID, sc.Episode, time.Unix(sc.AiringAt, 0).UTC()); err != nil {
				return total, err
			}
			total++
		}
		if !hasNext {
			break
		}
	}
	if err := s.cache.BumpGeneration(ctx, cache.GenSchedule); err != nil {
		s.log.Warn("schedule generation bump failed", "err", err)
	}
	s.log.Info("airing schedule synced", "from", from, "to", to, "episodes", total)
	return total, nil
}

func (s *Syncer) upsertEpisodeAiring(ctx context.Context, animeID int64, episode int, airingAt time.Time) error {
	if err := s.q.UpsertEpisode(ctx, sqlcgen.UpsertEpisodeParams{
		AnimeID:  animeID,
		Number:   int32(episode),
		AiringAt: &airingAt,
	}); err != nil {
		return fmt.Errorf("upsert episode anime=%d ep=%d: %w", animeID, episode, err)
	}
	return nil
}

// CurrentSeason returns the season/year pair for a given time, plus the next
// season (charts always show both).
func CurrentSeason(t time.Time) (season string, year int) {
	switch t.Month() {
	case time.January, time.February, time.March:
		return "WINTER", t.Year()
	case time.April, time.May, time.June:
		return "SPRING", t.Year()
	case time.July, time.August, time.September:
		return "SUMMER", t.Year()
	default:
		return "FALL", t.Year()
	}
}

// NextSeason returns the season after the given one.
func NextSeason(season string, year int) (string, int) {
	switch season {
	case "WINTER":
		return "SPRING", year
	case "SPRING":
		return "SUMMER", year
	case "SUMMER":
		return "FALL", year
	default:
		return "WINTER", year + 1
	}
}
