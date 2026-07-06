// The Cour background worker: asynq task handlers and the periodic-job
// scheduler (AniList sync, trending recompute, notifications).
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/hibiken/asynq"
	"golang.org/x/sync/errgroup"

	"cour/internal/anilist"
	"cour/internal/cache"
	"cour/internal/config"
	"cour/internal/discovery"
	"cour/internal/jobs"
	"cour/internal/logging"
	"cour/internal/notify"
	"cour/internal/store"
	"cour/internal/store/sqlcgen"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	log := logging.New(cfg)

	pool, err := store.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Error("postgres", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	rdb := cache.NewRedis(cfg.RedisAddr)
	defer func() { _ = rdb.Close() }()

	queries := sqlcgen.New(pool)
	appCache := cache.New(rdb)
	syncer := anilist.NewSyncer(anilist.NewClient(log), queries, appCache, log)

	redisOpt := asynq.RedisClientOpt{Addr: cfg.RedisAddr}
	logger := jobs.SlogLogger{L: log}

	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: 10,
		Queues: map[string]int{
			jobs.QueueCritical: 6, // notifications, user-facing side effects
			jobs.QueueDefault:  3, // sync, recompute
			jobs.QueueLow:      1, // backfills, upstream trending
		},
		Logger: logger,
	})

	// Stays open for the process lifetime: handlers use it to chain follow-up
	// tasks (catalog backfill chunks), not just for the bootstrap enqueues.
	client := asynq.NewClient(redisOpt)
	defer func() { _ = client.Close() }()

	mux := asynq.NewServeMux()
	jobs.RegisterHandlers(mux, jobs.Deps{
		Syncer:    syncer,
		Discovery: discovery.New(pool, appCache, discovery.DefaultTrendingConfig(), log),
		Enqueuer:  client,
		Log:       log,
		DemoMode:  cfg.DemoMode,
	})
	notify.NewHandlers(queries, rdb, log).Register(mux)

	scheduler := asynq.NewScheduler(redisOpt, &asynq.SchedulerOpts{Logger: logger})
	if err := jobs.Schedule(scheduler); err != nil {
		log.Error("schedule", "err", err)
		os.Exit(1)
	}

	jobs.Bootstrap(client, cfg.DemoMode, log)

	log.Info("worker starting", "env", cfg.Env, "demo_mode", cfg.DemoMode)
	var g errgroup.Group
	g.Go(func() error { return srv.Run(mux) })
	g.Go(func() error { return scheduler.Run() })
	if err := g.Wait(); err != nil {
		log.Error("worker", "err", err)
		os.Exit(1)
	}
}
