// Package config loads runtime configuration from the environment with
// dev-friendly defaults, so `go run ./cmd/api` works against the compose
// infra with zero setup.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Env         string // dev | test | prod
	Port        int
	DatabaseURL string
	RedisAddr   string
	LogLevel    slog.Level
	AutoMigrate bool
	DemoMode    bool // never call AniList; serve committed fixtures only
	WebOrigin   string
}

func (c Config) Dev() bool { return c.Env == "dev" }

func Load() (Config, error) {
	env := str("COUR_ENV", "dev")
	switch env {
	case "dev", "test", "prod":
	default:
		return Config{}, fmt.Errorf("COUR_ENV must be dev, test, or prod (got %q)", env)
	}

	port, err := integer("PORT", 8080)
	if err != nil {
		return Config{}, err
	}

	level, err := logLevel(str("LOG_LEVEL", "info"))
	if err != nil {
		return Config{}, err
	}

	autoMigrate, err := boolean("AUTO_MIGRATE", env == "dev")
	if err != nil {
		return Config{}, err
	}
	demoMode, err := boolean("DEMO_MODE", false)
	if err != nil {
		return Config{}, err
	}

	return Config{
		Env:         env,
		Port:        port,
		DatabaseURL: str("DATABASE_URL", "postgres://cour:cour@localhost:5434/cour?sslmode=disable"),
		RedisAddr:   str("REDIS_ADDR", "localhost:6380"),
		LogLevel:    level,
		AutoMigrate: autoMigrate,
		DemoMode:    demoMode,
		WebOrigin:   strings.TrimRight(str("WEB_ORIGIN", "http://localhost:3000"), "/"),
	}, nil
}

func str(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func integer(key string, def int) (int, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer (got %q)", key, v)
	}
	return n, nil
}

func boolean(key string, def bool) (bool, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean (got %q)", key, v)
	}
	return b, nil
}

func logLevel(s string) (slog.Level, error) {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return 0, fmt.Errorf("LOG_LEVEL must be debug, info, warn, or error (got %q)", s)
}
