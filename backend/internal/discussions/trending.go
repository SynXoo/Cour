package discussions

// Thread velocity: which threads are busy right now. Same decay shape as
// discovery's Trending Now, but on comments with a much shorter half-life —
// a thread's heat lives on a nightly cadence, not a weekly one — plus a bonus
// for readers connected to the live SSE stream. Serves GET /threads/trending;
// formula documented in docs/ALGORITHMS.md.

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/cache"
	"cour/internal/store/sqlcgen"
)

const (
	// velocityWindow bounds the comment scan (comments_created_at_idx); older
	// comments have decayed to noise anyway.
	velocityWindow = 48 * time.Hour
	// velocityHalfLife: a comment is worth half its heat six hours later, ~1%
	// after two days. Tuned for "tonight's episode", not "this week's show".
	velocityHalfLife = 6 * time.Hour
	// presenceWeight: one live reader counts like two fresh comments — lurkers
	// gathering before an episode make a thread hot before anyone posts.
	presenceWeight = 2.0

	trendingThreadsMax = 20
	trendingThreadsTTL = 60 * time.Second
	trendingThreadsKey = "threads:trending:v1"
)

// PresenceSource is the realtime hub seam: live reader counts per thread.
type PresenceSource interface {
	Presences() map[int64]int
}

// Trending computes and caches the busiest-threads ranking.
type Trending struct {
	q        *sqlcgen.Queries
	cache    *cache.Cache
	presence PresenceSource
	log      *slog.Logger
}

func NewTrending(pool *pgxpool.Pool, c *cache.Cache, p PresenceSource, log *slog.Logger) *Trending {
	return &Trending{q: sqlcgen.New(pool), cache: c, presence: p, log: log}
}

// rankedThread is the cached ranking row (stats only; hydration is per
// request so anime/thread data is never 60s stale).
type rankedThread struct {
	ThreadID       int64   `json:"thread_id"`
	Score          float64 `json:"score"`
	RecentComments int     `json:"recent_comments"`
	Presence       int     `json:"presence"`
}

// scoreThreads applies the velocity formula:
//
//	score(t) = Σ_comments 2^(−age/half_life) + presenceWeight·live_readers
//
// Threads appear if they have either recent comments or live readers.
func scoreThreads(comments []sqlcgen.RecentCommentsRow, presence map[int64]int, halfLife time.Duration, now time.Time) []rankedThread {
	byID := map[int64]*rankedThread{}
	at := func(id int64) *rankedThread {
		if r := byID[id]; r != nil {
			return r
		}
		r := &rankedThread{ThreadID: id}
		byID[id] = r
		return r
	}

	for _, c := range comments {
		age := now.Sub(c.CreatedAt)
		if age < 0 {
			age = 0
		}
		r := at(c.ThreadID)
		r.Score += math.Exp2(-age.Hours() / halfLife.Hours())
		r.RecentComments++
	}
	for id, count := range presence {
		if count <= 0 {
			continue
		}
		r := at(id)
		r.Score += presenceWeight * float64(count)
		r.Presence = count
	}

	out := make([]rankedThread, 0, len(byID))
	for _, r := range byID {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ThreadID < out[j].ThreadID // deterministic ties
	})
	return out
}

// TrendingThreadView is one ranked thread hydrated with its page context.
type TrendingThreadView struct {
	Thread          sqlcgen.Thread
	Anime           sqlcgen.Anime
	EpisodeNumber   *int32
	EpisodeTitle    *string
	EpisodeAiringAt *time.Time
	RecentComments  int
	Presence        int
}

// Trending returns the busiest threads, most heated first. The ranking is
// cached for 60s; hydration and the presence counts shown are live.
func (t *Trending) Trending(ctx context.Context, limit int) ([]TrendingThreadView, error) {
	if limit <= 0 || limit > trendingThreadsMax {
		limit = trendingThreadsMax
	}

	var ranked []rankedThread
	found, err := t.cache.GetJSON(ctx, trendingThreadsKey, &ranked)
	if err != nil {
		// Serve without the cache rather than failing the page.
		t.log.Warn("thread trending cache read", "err", err)
	}
	if !found {
		now := time.Now().UTC()
		comments, err := t.q.RecentComments(ctx, now.Add(-velocityWindow))
		if err != nil {
			return nil, fmt.Errorf("recent comments: %w", err)
		}
		ranked = scoreThreads(comments, t.presence.Presences(), velocityHalfLife, now)
		if len(ranked) > trendingThreadsMax {
			ranked = ranked[:trendingThreadsMax]
		}
		if err := t.cache.SetJSON(ctx, trendingThreadsKey, ranked, trendingThreadsTTL); err != nil {
			t.log.Warn("thread trending cache write", "err", err)
		}
	}
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	if len(ranked) == 0 {
		return []TrendingThreadView{}, nil
	}

	ids := make([]int64, len(ranked))
	for i, r := range ranked {
		ids[i] = r.ThreadID
	}
	rows, err := t.q.ThreadsWithContext(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("hydrate threads: %w", err)
	}
	byID := make(map[int64]sqlcgen.ThreadsWithContextRow, len(rows))
	for _, row := range rows {
		byID[row.Thread.ID] = row
	}

	// Presence moves faster than the 60s ranking — show the live count.
	live := t.presence.Presences()

	views := make([]TrendingThreadView, 0, len(ranked))
	for _, r := range ranked {
		row, ok := byID[r.ThreadID]
		if !ok {
			continue // thread vanished since ranking (cascade delete)
		}
		views = append(views, TrendingThreadView{
			Thread:          row.Thread,
			Anime:           row.Anime,
			EpisodeNumber:   row.EpisodeNumber,
			EpisodeTitle:    row.EpisodeTitle,
			EpisodeAiringAt: row.EpisodeAiringAt,
			RecentComments:  r.RecentComments,
			Presence:        live[r.ThreadID],
		})
	}
	return views, nil
}
