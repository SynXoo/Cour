// Package discovery implements the recency thesis: trending with exponential
// time decay, hidden gems, and taste-based recommendations. Formulas and
// weights are documented in docs/ALGORITHMS.md and tunable via environment.
package discovery

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"cour/internal/cache"
	"cour/internal/store/sqlcgen"
)

// TrendingConfig: score(a) = Σ_events w(type)·2^(−age/half_life) + blend·upstream_norm·upstreamScale
type TrendingConfig struct {
	HalfLife      time.Duration
	Window        time.Duration
	Weights       map[sqlcgen.ActivityType]float64
	UpstreamBlend float64 // β: how much AniList's own trending counts
}

// DefaultTrendingConfig per the documented formula; every knob has an env
// override (TRENDING_HALF_LIFE, TRENDING_WINDOW, TRENDING_BLEND,
// TRENDING_WEIGHT_<TYPE>).
func DefaultTrendingConfig() TrendingConfig {
	cfg := TrendingConfig{
		HalfLife: 96 * time.Hour,
		Window:   14 * 24 * time.Hour,
		Weights: map[sqlcgen.ActivityType]float64{
			sqlcgen.ActivityTypeListAdd:      1.0,
			sqlcgen.ActivityTypeStatusChange: 0.5,
			sqlcgen.ActivityTypeProgress:     0.3,
			sqlcgen.ActivityTypeCompleted:    1.2,
			sqlcgen.ActivityTypeScored:       0.8,
			sqlcgen.ActivityTypeFavorite:     2.5,
			sqlcgen.ActivityTypeReview:       3.0,
			sqlcgen.ActivityTypeComment:      1.5,
			sqlcgen.ActivityTypeHelpfulVote:  0.5,
		},
		UpstreamBlend: 0.15,
	}
	if d, err := time.ParseDuration(os.Getenv("TRENDING_HALF_LIFE")); err == nil && d > 0 {
		cfg.HalfLife = d
	}
	if d, err := time.ParseDuration(os.Getenv("TRENDING_WINDOW")); err == nil && d > 0 {
		cfg.Window = d
	}
	if f, err := strconv.ParseFloat(os.Getenv("TRENDING_BLEND"), 64); err == nil && f >= 0 {
		cfg.UpstreamBlend = f
	}
	for t := range cfg.Weights {
		env := "TRENDING_WEIGHT_" + string(t)
		if f, err := strconv.ParseFloat(os.Getenv(env), 64); err == nil && f >= 0 {
			cfg.Weights[t] = f
		}
	}
	return cfg
}

// upstreamScale converts the normalized (0..1) AniList trending signal into
// weighted-activity-equivalent points, so β stays an intuitive 0..1 knob.
const upstreamScale = 20.0

const trendingSize = 100

// Redis keys owned by the trending job.
const (
	trendingZSet  = "trending:v1"
	trendingMeta  = "trending:v1:computed_at"
	hiddenGemsKey = "gems:v1"
	gemsMinScore  = 72
	gemsLimit     = 50
	gemsYearsBack = 1 // season_year >= currentYear-1 ~= last 4-8 seasons
)

type Service struct {
	q     *sqlcgen.Queries
	cache *cache.Cache
	rdb   *redis.Client
	cfg   TrendingConfig
	log   *slog.Logger
}

func New(pool *pgxpool.Pool, c *cache.Cache, cfg TrendingConfig, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), cache: c, rdb: c.R, cfg: cfg, log: log}
}

// event is the minimal activity shape the scorer needs (decoupled from sqlc
// for testability).
type event struct {
	AnimeID   int64
	Type      sqlcgen.ActivityType
	CreatedAt time.Time
}

// scoreEvents applies the decay formula to a batch of events.
func scoreEvents(events []event, weights map[sqlcgen.ActivityType]float64, halfLife time.Duration, now time.Time) map[int64]float64 {
	scores := map[int64]float64{}
	for _, e := range events {
		w := weights[e.Type]
		if w == 0 {
			continue
		}
		age := now.Sub(e.CreatedAt)
		if age < 0 {
			age = 0
		}
		decay := math.Exp2(-age.Hours() / halfLife.Hours())
		scores[e.AnimeID] += w * decay
	}
	return scores
}

// blendUpstream folds the normalized AniList trending signal into the local
// scores: score += β · (upstream/max) · upstreamScale.
func blendUpstream(scores map[int64]float64, upstream map[int64]int32, beta float64) {
	if beta <= 0 || len(upstream) == 0 {
		return
	}
	var max int32
	for _, v := range upstream {
		if v > max {
			max = v
		}
	}
	if max == 0 {
		return
	}
	for animeID, v := range upstream {
		scores[animeID] += beta * (float64(v) / float64(max)) * upstreamScale
	}
}

type ranked struct {
	AnimeID int64
	Score   float64
}

func rankScores(scores map[int64]float64, limit int) []ranked {
	out := make([]ranked, 0, len(scores))
	for id, s := range scores {
		out = append(out, ranked{AnimeID: id, Score: s})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].AnimeID < out[j].AnimeID // deterministic ties
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// RecomputeTrending runs the full pipeline: window query → decay → blend →
// rank → Redis ZSET + durable snapshot.
func (s *Service) RecomputeTrending(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	since := now.Add(-s.cfg.Window)

	rows, err := s.q.RecentAnimeActivity(ctx, since)
	if err != nil {
		return 0, fmt.Errorf("recent activity: %w", err)
	}
	events := make([]event, 0, len(rows))
	for _, r := range rows {
		if r.AnimeID == nil {
			continue
		}
		events = append(events, event{AnimeID: *r.AnimeID, Type: r.Type, CreatedAt: r.CreatedAt})
	}

	scores := scoreEvents(events, s.cfg.Weights, s.cfg.HalfLife, now)

	upstreamRows, err := s.q.UpstreamTrendingSignal(ctx)
	if err != nil {
		return 0, fmt.Errorf("upstream signal: %w", err)
	}
	upstream := make(map[int64]int32, len(upstreamRows))
	for _, r := range upstreamRows {
		upstream[r.AnimeID] = r.AnilistTrending
	}
	blendUpstream(scores, upstream, s.cfg.UpstreamBlend)

	top := rankScores(scores, trendingSize)

	// Serve path: Redis ZSET replaced atomically via pipeline.
	pipe := s.rdb.TxPipeline()
	pipe.Del(ctx, trendingZSet)
	for _, r := range top {
		pipe.ZAdd(ctx, trendingZSet, redis.Z{Score: r.Score, Member: strconv.FormatInt(r.AnimeID, 10)})
	}
	pipe.Set(ctx, trendingMeta, now.Format(time.RFC3339), 0)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("write zset: %w", err)
	}

	// Durable snapshot.
	if err := s.q.ReplaceTrendingScores(ctx); err != nil {
		return 0, fmt.Errorf("clear snapshot: %w", err)
	}
	for i, r := range top {
		if err := s.q.InsertTrendingScore(ctx, sqlcgen.InsertTrendingScoreParams{
			AnimeID: r.AnimeID, Score: r.Score, Rank: int32(i + 1), ComputedAt: now,
		}); err != nil {
			return 0, fmt.Errorf("insert snapshot: %w", err)
		}
	}

	s.log.Info("trending recomputed", "events", len(events), "ranked", len(top))
	return len(top), nil
}

// Trending reads the ranked list (Redis) and hydrates anime rows in order.
func (s *Service) Trending(ctx context.Context, limit int) ([]sqlcgen.Anime, time.Time, error) {
	if limit <= 0 || limit > trendingSize {
		limit = trendingSize
	}
	members, err := s.rdb.ZRangeArgs(ctx, redis.ZRangeArgs{
		Key: trendingZSet, Start: 0, Stop: int64(limit - 1), Rev: true,
	}).Result()
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("zset read: %w", err)
	}
	ids := make([]int64, 0, len(members))
	for _, m := range members {
		if id, err := strconv.ParseInt(m, 10, 64); err == nil {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return []sqlcgen.Anime{}, time.Time{}, nil
	}

	rows, err := s.q.ListAnimeByIDs(ctx, ids)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("hydrate: %w", err)
	}
	byID := make(map[int64]sqlcgen.Anime, len(rows))
	for _, a := range rows {
		byID[a.ID] = a
	}
	ordered := make([]sqlcgen.Anime, 0, len(ids))
	for _, id := range ids {
		if a, ok := byID[id]; ok {
			ordered = append(ordered, a)
		}
	}

	var computedAt time.Time
	if raw, err := s.rdb.Get(ctx, trendingMeta).Result(); err == nil {
		computedAt, _ = time.Parse(time.RFC3339, raw)
	}
	return ordered, computedAt, nil
}

// RecomputeHiddenGems refreshes the gems rail (cached as JSON ids).
func (s *Service) RecomputeHiddenGems(ctx context.Context) (int, error) {
	yearCutoff := int32(time.Now().Year() - gemsYearsBack)
	rows, err := s.q.HiddenGems(ctx, sqlcgen.HiddenGemsParams{
		SeasonYear:   &yearCutoff,
		AverageScore: ptrInt32(gemsMinScore),
		Limit:        gemsLimit,
	})
	if err != nil {
		return 0, fmt.Errorf("hidden gems query: %w", err)
	}
	ids := make([]int64, len(rows))
	for i, a := range rows {
		ids[i] = a.ID
	}
	if err := s.cache.SetJSON(ctx, hiddenGemsKey, ids, 0); err != nil {
		return 0, err
	}
	s.log.Info("hidden gems recomputed", "count", len(ids))
	return len(ids), nil
}

// HiddenGems serves the cached rail, computing on demand if empty.
func (s *Service) HiddenGems(ctx context.Context) ([]sqlcgen.Anime, error) {
	var ids []int64
	found, err := s.cache.GetJSON(ctx, hiddenGemsKey, &ids)
	if err != nil {
		s.log.Warn("gems cache read failed", "err", err)
	}
	if !found {
		if _, err := s.RecomputeHiddenGems(ctx); err != nil {
			return nil, err
		}
		if _, err := s.cache.GetJSON(ctx, hiddenGemsKey, &ids); err != nil {
			return nil, err
		}
	}
	if len(ids) == 0 {
		return []sqlcgen.Anime{}, nil
	}
	rows, err := s.q.ListAnimeByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("hydrate gems: %w", err)
	}
	byID := make(map[int64]sqlcgen.Anime, len(rows))
	for _, a := range rows {
		byID[a.ID] = a
	}
	ordered := make([]sqlcgen.Anime, 0, len(ids))
	for _, id := range ids {
		if a, ok := byID[id]; ok {
			ordered = append(ordered, a)
		}
	}
	return ordered, nil
}

func ptrInt32(v int32) *int32 { return &v }
