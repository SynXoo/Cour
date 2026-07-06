// Package jobs defines asynq task types, their handlers, and the periodic
// schedule. Task handlers are thin: they parse payloads and delegate to the
// owning subsystem.
package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/hibiken/asynq"

	"cour/internal/anilist"
	"cour/internal/discovery"
)

// Task type names, namespaced by subsystem.
const (
	TypeSyncSeasons     = "anilist:sync_seasons"     // current + next season charts
	TypeSyncAiring      = "anilist:sync_airing"      // airing schedule window
	TypeSyncTrending    = "anilist:sync_trending"    // AniList's own trending signal
	TypeSyncUpdated     = "anilist:sync_updated"     // media edited upstream since last watermark
	TypeBackfillCatalog = "anilist:backfill_catalog" // one-time full-catalog crawl

	TypeRecomputeDiscovery = "discovery:recompute" // trending scores + hidden gems
)

// backfillChunkPages bounds one backfill task to ~20s of rate-limited
// requests; the handler chains the next chunk until the crawl finishes.
const backfillChunkPages = 10

// Queue names, by user-visible urgency.
const (
	QueueCritical = "critical"
	QueueDefault  = "default"
	QueueLow      = "low"
)

type Deps struct {
	Syncer    *anilist.Syncer
	Discovery *discovery.Service
	Enqueuer  *asynq.Client // for tasks that chain follow-up tasks
	Log       *slog.Logger
	DemoMode  bool
}

func RegisterHandlers(mux *asynq.ServeMux, d Deps) {
	mux.HandleFunc(TypeSyncSeasons, d.demoGate(d.handleSyncSeasons))
	mux.HandleFunc(TypeSyncAiring, d.demoGate(d.handleSyncAiring))
	mux.HandleFunc(TypeSyncTrending, d.demoGate(d.handleSyncTrending))
	mux.HandleFunc(TypeSyncUpdated, d.demoGate(d.handleSyncUpdated))
	mux.HandleFunc(TypeBackfillCatalog, d.demoGate(d.handleBackfillCatalog))
	// Discovery works entirely on local data — never demo-gated.
	mux.HandleFunc(TypeRecomputeDiscovery, d.handleRecomputeDiscovery)
}

func (d Deps) handleRecomputeDiscovery(ctx context.Context, _ *asynq.Task) error {
	if _, err := d.Discovery.RecomputeTrending(ctx); err != nil {
		return fmt.Errorf("recompute trending: %w", err)
	}
	if _, err := d.Discovery.RecomputeHiddenGems(ctx); err != nil {
		return fmt.Errorf("recompute gems: %w", err)
	}
	return nil
}

// demoGate turns AniList-touching jobs into no-ops in demo mode, where the
// committed fixtures are the only data source.
func (d Deps) demoGate(h asynq.HandlerFunc) asynq.HandlerFunc {
	return func(ctx context.Context, t *asynq.Task) error {
		if d.DemoMode {
			d.Log.Info("demo mode: skipping task", "type", t.Type())
			return nil
		}
		return h(ctx, t)
	}
}

func (d Deps) handleSyncSeasons(ctx context.Context, _ *asynq.Task) error {
	season, year := anilist.CurrentSeason(time.Now())
	if _, err := d.Syncer.SyncSeason(ctx, season, year); err != nil {
		return fmt.Errorf("sync current season: %w", err)
	}
	nextSeason, nextYear := anilist.NextSeason(season, year)
	if _, err := d.Syncer.SyncSeason(ctx, nextSeason, nextYear); err != nil {
		return fmt.Errorf("sync next season: %w", err)
	}
	return nil
}

func (d Deps) handleSyncAiring(ctx context.Context, _ *asynq.Task) error {
	// Reach back a day so late schedule changes are corrected, forward a week
	// (+1 day of slack) to cover the schedule page.
	from := time.Now().Add(-24 * time.Hour)
	to := time.Now().Add(8 * 24 * time.Hour)
	if _, err := d.Syncer.SyncAiring(ctx, from, to); err != nil {
		return fmt.Errorf("sync airing: %w", err)
	}
	return nil
}

func (d Deps) handleSyncTrending(ctx context.Context, _ *asynq.Task) error {
	if _, err := d.Syncer.SyncTrendingUpstream(ctx); err != nil {
		return fmt.Errorf("sync trending: %w", err)
	}
	return nil
}

func (d Deps) handleSyncUpdated(ctx context.Context, _ *asynq.Task) error {
	if _, err := d.Syncer.SyncUpdated(ctx); err != nil {
		return fmt.Errorf("sync updated: %w", err)
	}
	return nil
}

// handleBackfillCatalog advances the full-catalog crawl one chunk, then
// chains the next chunk instead of holding one long-running task: each chunk
// is short, retryable, and the chain survives worker restarts via the queue.
// The cursor lives in Postgres, so a duplicate chain (e.g. bootstrap racing a
// live chain after a restart) only re-crawls a page or two — upserts are
// idempotent and both chains stop at the done flag.
func (d Deps) handleBackfillCatalog(ctx context.Context, _ *asynq.Task) error {
	done, err := d.Syncer.SyncCatalogChunk(ctx, backfillChunkPages)
	if err != nil {
		return fmt.Errorf("backfill catalog chunk: %w", err)
	}
	if done {
		return nil
	}
	_, err = d.Enqueuer.Enqueue(asynq.NewTask(TypeBackfillCatalog, nil, asynq.Queue(QueueLow)))
	if err != nil {
		return fmt.Errorf("enqueue next backfill chunk: %w", err)
	}
	return nil
}

// Schedule registers the periodic jobs. Stagger offsets keep the AniList
// bursts apart.
func Schedule(s *asynq.Scheduler) error {
	entries := []struct {
		spec string
		task *asynq.Task
	}{
		{"@every 6h", asynq.NewTask(TypeSyncSeasons, nil, asynq.Queue(QueueDefault))},
		{"@every 6h", asynq.NewTask(TypeSyncAiring, nil, asynq.Queue(QueueDefault))},
		{"@every 1h", asynq.NewTask(TypeSyncTrending, nil, asynq.Queue(QueueLow))},
		{"@every 6h", asynq.NewTask(TypeSyncUpdated, nil, asynq.Queue(QueueLow))},
		// New-episode alerts scan the schedule regardless of demo mode —
		// they read our own DB, not AniList.
		{"@every 30m", asynq.NewTask("notify:episodes_aired", nil, asynq.Queue(QueueCritical))},
		{"@every 15m", asynq.NewTask(TypeRecomputeDiscovery, nil, asynq.Queue(QueueDefault))},
	}
	for _, e := range entries {
		if _, err := s.Register(e.spec, e.task); err != nil {
			return fmt.Errorf("schedule %s: %w", e.task.Type(), err)
		}
	}
	return nil
}

// Bootstrap enqueues one immediate run of every sync so a fresh install
// populates without waiting for the first tick. Uniqueness suppresses
// duplicates from worker restarts. Discovery always runs (it reads local
// data); AniList syncs are skipped in demo mode. The backfill enqueue is
// cheap even on an already-mirrored install — its handler no-ops once the
// crawl's done flag is set.
func Bootstrap(client *asynq.Client, demoMode bool, log *slog.Logger) {
	queues := map[string]string{TypeRecomputeDiscovery: QueueDefault}
	if !demoMode {
		queues[TypeSyncSeasons] = QueueDefault
		queues[TypeSyncAiring] = QueueDefault
		queues[TypeSyncTrending] = QueueLow
		queues[TypeSyncUpdated] = QueueLow
		queues[TypeBackfillCatalog] = QueueLow
	}
	for typ, queue := range queues {
		_, err := client.Enqueue(asynq.NewTask(typ, nil), asynq.Queue(queue), asynq.Unique(30*time.Minute))
		if err != nil && !isDuplicate(err) {
			log.Warn("bootstrap enqueue failed", "type", typ, "err", err)
		}
	}
}

func isDuplicate(err error) bool {
	return errors.Is(err, asynq.ErrDuplicateTask) || errors.Is(err, asynq.ErrTaskIDConflict)
}

// SlogLogger adapts slog to asynq's logger interface.
type SlogLogger struct{ L *slog.Logger }

func (a SlogLogger) Debug(args ...any) { a.L.Debug(fmt.Sprint(args...)) }
func (a SlogLogger) Info(args ...any)  { a.L.Info(fmt.Sprint(args...)) }
func (a SlogLogger) Warn(args ...any)  { a.L.Warn(fmt.Sprint(args...)) }
func (a SlogLogger) Error(args ...any) { a.L.Error(fmt.Sprint(args...)) }
func (a SlogLogger) Fatal(args ...any) {
	a.L.Error(fmt.Sprint(args...))
	os.Exit(1)
}
