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
)

// Task type names, namespaced by subsystem.
const (
	TypeSyncSeasons  = "anilist:sync_seasons"  // current + next season charts
	TypeSyncAiring   = "anilist:sync_airing"   // airing schedule window
	TypeSyncTrending = "anilist:sync_trending" // AniList's own trending signal
)

// Queue names, by user-visible urgency.
const (
	QueueCritical = "critical"
	QueueDefault  = "default"
	QueueLow      = "low"
)

type Deps struct {
	Syncer   *anilist.Syncer
	Log      *slog.Logger
	DemoMode bool
}

func RegisterHandlers(mux *asynq.ServeMux, d Deps) {
	mux.HandleFunc(TypeSyncSeasons, d.demoGate(d.handleSyncSeasons))
	mux.HandleFunc(TypeSyncAiring, d.demoGate(d.handleSyncAiring))
	mux.HandleFunc(TypeSyncTrending, d.demoGate(d.handleSyncTrending))
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
// duplicates from worker restarts.
func Bootstrap(client *asynq.Client, log *slog.Logger) {
	for _, t := range []string{TypeSyncSeasons, TypeSyncAiring, TypeSyncTrending} {
		_, err := client.Enqueue(asynq.NewTask(t, nil), asynq.Queue(QueueDefault), asynq.Unique(30*time.Minute))
		if err != nil && !isDuplicate(err) {
			log.Warn("bootstrap enqueue failed", "type", t, "err", err)
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
