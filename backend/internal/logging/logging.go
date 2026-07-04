// Package logging builds the process-wide slog logger: human-readable text
// in dev, JSON everywhere else.
package logging

import (
	"log/slog"
	"os"

	"cour/internal/config"
)

func New(cfg config.Config) *slog.Logger {
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	var h slog.Handler
	if cfg.Dev() {
		h = slog.NewTextHandler(os.Stdout, opts)
	} else {
		h = slog.NewJSONHandler(os.Stdout, opts)
	}
	return slog.New(h)
}
