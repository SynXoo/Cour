//go:build integration

// Package integration exercises the real stack: actual Postgres and Redis in
// containers, the real router, real HTTP. Run with:
//
//	go test -tags integration ./internal/integration/
package integration

import (
	"context"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"cour/internal/cache"
	"cour/internal/config"
	"cour/internal/httpapi"
	"cour/internal/store"
)

var (
	testServer *httptest.Server
	testPool   *pgxpool.Pool
	testRedis  *redis.Client
)

func TestMain(m *testing.M) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	code, err := run(ctx, m)
	if err != nil {
		fmt.Fprintln(os.Stderr, "integration setup:", err)
		os.Exit(1)
	}
	os.Exit(code)
}

func run(ctx context.Context, m *testing.M) (int, error) {
	pgC, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "postgres:17-alpine",
			Env:          map[string]string{"POSTGRES_USER": "test", "POSTGRES_PASSWORD": "test", "POSTGRES_DB": "test"},
			ExposedPorts: []string{"5432/tcp"},
			WaitingFor:   wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(90 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		return 0, fmt.Errorf("postgres container: %w", err)
	}
	defer func() { _ = pgC.Terminate(context.Background()) }()

	redisC, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "redis:8-alpine",
			ExposedPorts: []string{"6379/tcp"},
			WaitingFor:   wait.ForLog("Ready to accept connections").WithStartupTimeout(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		return 0, fmt.Errorf("redis container: %w", err)
	}
	defer func() { _ = redisC.Terminate(context.Background()) }()

	pgHost, err := pgC.Host(ctx)
	if err != nil {
		return 0, err
	}
	pgPort, err := pgC.MappedPort(ctx, "5432/tcp")
	if err != nil {
		return 0, err
	}
	databaseURL := fmt.Sprintf("postgres://test:test@%s:%s/test?sslmode=disable", pgHost, pgPort.Port())

	redisHost, err := redisC.Host(ctx)
	if err != nil {
		return 0, err
	}
	redisPort, err := redisC.MappedPort(ctx, "6379/tcp")
	if err != nil {
		return 0, err
	}
	redisAddr := fmt.Sprintf("%s:%s", redisHost, redisPort.Port())

	log := slog.New(slog.DiscardHandler)

	if err := store.Migrate(databaseURL, log); err != nil {
		return 0, fmt.Errorf("migrate: %w", err)
	}

	testPool, err = store.NewPool(ctx, databaseURL)
	if err != nil {
		return 0, fmt.Errorf("pool: %w", err)
	}
	defer testPool.Close()

	testRedis = cache.NewRedis(redisAddr)
	defer func() { _ = testRedis.Close() }()

	cfg := config.Config{
		Env:             "test",
		Port:            0,
		DatabaseURL:     databaseURL,
		RedisAddr:       redisAddr,
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 720 * time.Hour,
		WebOrigin:       "http://localhost:3000",
		EmailMode:       "log",
		WatchParties:    true,
	}
	handler, err := httpapi.NewRouter(httpapi.Deps{Cfg: cfg, Log: log, Pool: testPool, Redis: testRedis})
	if err != nil {
		return 0, fmt.Errorf("router: %w", err)
	}
	testServer = httptest.NewServer(handler)
	defer testServer.Close()

	return m.Run(), nil
}
