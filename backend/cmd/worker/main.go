// The Cour background worker: asynq task handlers and the periodic-job
// scheduler (AniList sync, trending recompute, notifications).
package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/hibiken/asynq"

	"cour/internal/config"
	"cour/internal/logging"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	log := logging.New(cfg)

	redisOpt := asynq.RedisClientOpt{Addr: cfg.RedisAddr}
	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: 10,
		Queues: map[string]int{
			"critical": 6, // notifications, user-facing side effects
			"default":  3, // sync, recompute
			"low":      1, // backfills
		},
		Logger: slogAdapter{log},
	})

	mux := asynq.NewServeMux()
	// Task handlers register here, one Register* function per domain slice.

	log.Info("worker starting", "env", cfg.Env, "demo_mode", cfg.DemoMode)
	if err := srv.Run(mux); err != nil {
		log.Error("worker", "err", err)
		os.Exit(1)
	}
}

// slogAdapter satisfies asynq's Logger interface with slog underneath.
type slogAdapter struct{ l *slog.Logger }

func (a slogAdapter) Debug(args ...any) { a.l.Debug(fmt.Sprint(args...)) }
func (a slogAdapter) Info(args ...any)  { a.l.Info(fmt.Sprint(args...)) }
func (a slogAdapter) Warn(args ...any)  { a.l.Warn(fmt.Sprint(args...)) }
func (a slogAdapter) Error(args ...any) { a.l.Error(fmt.Sprint(args...)) }
func (a slogAdapter) Fatal(args ...any) {
	a.l.Error(fmt.Sprint(args...))
	os.Exit(1)
}
