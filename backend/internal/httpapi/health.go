package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type healthHandler struct {
	pool *pgxpool.Pool
	rdb  *redis.Client
}

// healthz: liveness — the process is up and serving.
func (h healthHandler) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// readyz: readiness — dependencies are reachable.
func (h healthHandler) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	deps := map[string]string{"postgres": "ok", "redis": "ok"}
	healthy := true
	if err := h.pool.Ping(ctx); err != nil {
		deps["postgres"] = err.Error()
		healthy = false
	}
	if err := h.rdb.Ping(ctx).Err(); err != nil {
		deps["redis"] = err.Error()
		healthy = false
	}

	if !healthy {
		writeErrorDetails(w, http.StatusServiceUnavailable, CodeUnavailable, "dependencies unavailable", deps)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "deps": deps})
}
