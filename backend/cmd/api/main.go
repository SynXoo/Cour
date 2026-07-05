// The Cour HTTP API server.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cour/internal/cache"
	"cour/internal/config"
	"cour/internal/httpapi"
	"cour/internal/logging"
	"cour/internal/store"
)

func main() {
	migrateOnly := flag.Bool("migrate-only", false, "apply pending migrations and exit")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	log := logging.New(cfg)

	if *migrateOnly || cfg.AutoMigrate {
		if err := store.Migrate(cfg.DatabaseURL, log); err != nil {
			log.Error("migrate", "err", err)
			os.Exit(1)
		}
		if *migrateOnly {
			return
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := store.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("postgres", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	rdb := cache.NewRedis(cfg.RedisAddr)
	defer func() { _ = rdb.Close() }()

	handler, err := httpapi.NewRouter(httpapi.Deps{
		Cfg:   cfg,
		Log:   log,
		Pool:  pool,
		Redis: rdb,
	})
	if err != nil {
		log.Error("router", "err", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	go func() {
		log.Info("api listening", "port", cfg.Port, "env", cfg.Env, "demo_mode", cfg.DemoMode)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("serve", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown", "err", err)
	}
}
