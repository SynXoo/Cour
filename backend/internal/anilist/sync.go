package anilist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"cour/internal/cache"
	"cour/internal/store/sqlcgen"
)

// Page sizes and caps keep a single sync bounded no matter what the upstream
// returns.
const (
	perPage        = 50
	maxSeasonPages = 8  // a season tops out around ~300 titles
	maxAiringPages = 24 // ~1200 schedule entries per window
	maxDeltaPages  = 30 // ~1500 upstream edits per refresh tick
)

// sync_state keys. The backfill crawls the whole catalog once (cursor survives
// restarts); the delta watermark then keeps the mirror fresh incrementally.
const (
	stateKeyBackfill = "anilist_backfill"
	stateKeyDelta    = "anilist_delta"
)

type backfillState struct {
	Window int  `json:"window"` // index into catalogWindows
	Page   int  `json:"page"`   // next page within the window, 1-based
	Done   bool `json:"done"`
}

type deltaState struct {
	Since int64 `json:"since"` // unix seconds; media edited after this get re-fetched
}

// catalogWindow is one partition of the full-catalog crawl. AniList caps
// offset pagination at 5,000 entries per query, so the crawl runs window by
// window, each safely under the cap. Exactly one of status / date range is
// set.
type catalogWindow struct {
	status                  string // MediaStatus; also catches entries with no start date
	dateGreater, dateLesser int    // exclusive FuzzyDateInt bounds (YYYYMMDD)
	label                   string
}

// catalogWindows builds the deterministic window list: status windows for
// date-less entries (announcements, cancellations), decades through the
// sparse early history, then one window per year. The list only ever grows
// at the tail (new years), so a persisted window index stays valid.
func catalogWindows(now time.Time) []catalogWindow {
	ws := []catalogWindow{
		{status: "NOT_YET_RELEASED", label: "not_yet_released"},
		{status: "CANCELLED", label: "cancelled"},
	}
	for decade := 1910; decade < 1980; decade += 10 {
		ws = append(ws, catalogWindow{
			dateGreater: decade*10000 - 1,
			dateLesser:  (decade + 10) * 10000,
			label:       fmt.Sprintf("%ds", decade),
		})
	}
	for year := 1980; year <= now.Year()+2; year++ {
		ws = append(ws, catalogWindow{
			dateGreater: year*10000 - 1,
			dateLesser:  (year + 1) * 10000,
			label:       fmt.Sprintf("%d", year),
		})
	}
	return ws
}

// loadState unmarshals a sync_state row into dest; a missing row leaves dest
// at its zero value.
func (s *Syncer) loadState(ctx context.Context, key string, dest any) error {
	raw, err := s.q.GetSyncState(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load sync state %s: %w", key, err)
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("decode sync state %s: %w", key, err)
	}
	return nil
}

func (s *Syncer) saveState(ctx context.Context, key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("encode sync state %s: %w", key, err)
	}
	if err := s.q.SetSyncState(ctx, sqlcgen.SetSyncStateParams{Key: key, Value: raw}); err != nil {
		return fmt.Errorf("save sync state %s: %w", key, err)
	}
	return nil
}

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

// SyncCatalogChunk advances the one-time full-catalog crawl by up to maxPages
// requests, persisting the cursor after every page so a restart resumes
// mid-crawl instead of starting over. Returns done=true once the whole
// catalog has been seen (including when a previous run already finished).
func (s *Syncer) SyncCatalogChunk(ctx context.Context, maxPages int) (bool, error) {
	var st backfillState
	if err := s.loadState(ctx, stateKeyBackfill, &st); err != nil {
		return false, err
	}
	if st.Done {
		return true, nil
	}
	if st.Page == 0 {
		st.Page = 1
	}
	windows := catalogWindows(time.Now())
	for i := 0; i < maxPages && st.Window < len(windows); i++ {
		w := windows[st.Window]
		media, hasNext, err := s.client.CatalogPage(ctx, w, st.Page, perPage)
		if err != nil {
			return false, fmt.Errorf("catalog window %s page %d: %w", w.label, st.Page, err)
		}
		if _, err := s.UpsertMedia(ctx, media); err != nil {
			return false, err
		}
		if hasNext && (st.Page+1)*perPage > 5000 {
			// Should never happen — windows are sized well under AniList's
			// pagination cap. Skip ahead rather than error-loop forever.
			s.log.Warn("catalog window hit the pagination cap, tail skipped", "window", w.label)
			hasNext = false
		}
		if hasNext {
			st.Page++
		} else {
			st.Window++
			st.Page = 1
		}
		st.Done = st.Window >= len(windows)
		if err := s.saveState(ctx, stateKeyBackfill, st); err != nil {
			return false, err
		}
		if st.Done {
			s.log.Info("catalog backfill complete", "windows", len(windows))
			return true, nil
		}
	}
	s.log.Info("catalog backfill chunk synced",
		"window", windows[st.Window].label, "page", st.Page,
		"windows_left", len(windows)-st.Window)
	return false, nil
}

// SyncUpdated re-fetches media edited upstream since the stored watermark —
// new announcements and metadata fixes. AniList has no updatedAt filter, so
// it reads the edit-ordered feed newest-first and stops at the first entry
// at or below the watermark. If the page cap cuts the run short (first run,
// or an upstream edit spike), the watermark advances to the oldest edit
// seen: everything newer is mirrored, so progress stays monotonic and later
// ticks converge instead of re-reading the same pages forever.
func (s *Syncer) SyncUpdated(ctx context.Context) (int, error) {
	var st deltaState
	if err := s.loadState(ctx, stateKeyDelta, &st); err != nil {
		return 0, err
	}
	if st.Since == 0 {
		// First run: backfill/fixtures cover history, so only recent edits
		// are interesting.
		st.Since = time.Now().Add(-24 * time.Hour).Unix()
	}
	start := time.Now()
	total := 0
	exhausted := false
	var oldestSeen int64
	for page := 1; page <= maxDeltaPages; page++ {
		media, hasNext, err := s.client.UpdatedPage(ctx, page, perPage)
		if err != nil {
			return total, fmt.Errorf("updated page %d: %w", page, err)
		}
		fresh := media[:0:0]
		for _, m := range media {
			if m.UpdatedAt == nil || *m.UpdatedAt <= st.Since {
				exhausted = true // reached edits we've already mirrored
				continue
			}
			if oldestSeen == 0 || *m.UpdatedAt < oldestSeen {
				oldestSeen = *m.UpdatedAt
			}
			fresh = append(fresh, m)
		}
		ids, err := s.UpsertMedia(ctx, fresh)
		if err != nil {
			return total, err
		}
		total += len(ids)
		if !hasNext {
			exhausted = true
		}
		if exhausted {
			break
		}
	}
	if exhausted {
		st.Since = start.Add(-time.Minute).Unix() // overlap absorbs clock skew
	} else {
		st.Since = oldestSeen
		s.log.Warn("updated sync hit page cap, watermark advanced to oldest edit seen",
			"since", st.Since, "titles", total)
	}
	if err := s.saveState(ctx, stateKeyDelta, st); err != nil {
		return total, err
	}
	s.log.Info("updated media synced", "titles", total)
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
