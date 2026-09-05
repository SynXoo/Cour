// seed loads the committed AniList fixtures (and, in later slices, generated
// demo users and activity) into the database. Idempotent; safe to re-run.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"cour/fixtures"
	"cour/internal/anilist"
	"cour/internal/cache"
	"cour/internal/config"
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

	if err := store.Migrate(cfg.DatabaseURL, log); err != nil {
		log.Error("migrate", "err", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := store.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("postgres", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	rdb := cache.NewRedis(cfg.RedisAddr)
	defer func() { _ = rdb.Close() }()

	snap, airing, err := anilist.LoadSnapshot(fixtures.FS)
	if err != nil {
		log.Error("fixtures", "err", err)
		os.Exit(1)
	}

	queries := sqlcgen.New(pool)
	syncer := anilist.NewSyncer(nil, queries, cache.New(rdb), log)
	n, err := syncer.SeedFromFixtures(ctx, snap, airing)
	if err != nil {
		log.Error("seed", "err", err)
		os.Exit(1)
	}
	log.Info("fixtures loaded",
		"anime", n,
		"airing_entries", len(airing.Entries),
		"snapshot_age", time.Since(snap.FetchedAt).Round(time.Hour).String(),
	)

	if err := seedDemo(ctx, pool, queries, log); err != nil {
		log.Error("demo seed", "err", err)
		os.Exit(1)
	}
	if err := seedFriends(ctx, pool, queries, log); err != nil {
		log.Error("social seed", "err", err)
		os.Exit(1)
	}
}
