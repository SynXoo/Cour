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
	"cour/internal/jobs"
	"cour/internal/logging"
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

	mux := asynq.NewServeMux()
	jobs.RegisterHandlers(mux, jobs.Deps{
		Syncer:   syncer,
		Log:      log,
		DemoMode: cfg.DemoMode,
	})

	scheduler := asynq.NewScheduler(redisOpt, &asynq.SchedulerOpts{Logger: logger})
	if err := jobs.Schedule(scheduler); err != nil {
		log.Error("schedule", "err", err)
		os.Exit(1)
	}

	if !cfg.DemoMode {
		client := asynq.NewClient(redisOpt)
		jobs.Bootstrap(client, log)
		_ = client.Close()
	}

	log.Info("worker starting", "env", cfg.Env, "demo_mode", cfg.DemoMode)
	var g errgroup.Group
	g.Go(func() error { return srv.Run(mux) })
	g.Go(func() error { return scheduler.Run() })
	if err := g.Wait(); err != nil {
		log.Error("worker", "err", err)
		os.Exit(1)
	}
}
