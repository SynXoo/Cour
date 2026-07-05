// Package httpapi assembles the versioned REST API: routing, middleware,
// request/response conventions (error envelope, pagination), and handlers.
package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"cour/internal/cache"
	"cour/internal/catalog"
	"cour/internal/config"
	"cour/internal/httpapi/apigen"
	"cour/internal/store/sqlcgen"
)

type Deps struct {
	Cfg   config.Config
	Log   *slog.Logger
	Pool  *pgxpool.Pool
	Redis *redis.Client
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()

	// Note: no RealIP/X-Forwarded-For handling here — trusting proxy headers
	// must be an explicit, deployment-aware decision (see rate limiting).
	r.Use(middleware.RequestID)
	r.Use(requestLogger(d.Log))
	r.Use(recoverer(d.Log))
	r.Use(middleware.Timeout(30 * time.Second))

	health := healthHandler{pool: d.Pool, rdb: d.Redis}
	r.Get("/healthz", health.healthz)
	r.Get("/readyz", health.readyz)

	queries := sqlcgen.New(d.Pool)
	appCache := cache.New(d.Redis)

	r.Route("/api/v1", func(r chi.Router) {
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeNotFound(w) })
		r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusMethodNotAllowed, CodeBadRequest, "method not allowed")
		})

		apigen.HandlerWithOptions(catalogHandlers{
			svc: catalog.New(queries, appCache, d.Log),
			log: d.Log,
		}, apigen.ChiServerOptions{
			BaseRouter: r,
			// Parameter binding failures (bad enum, non-numeric id, ...)
			ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				writeError(w, http.StatusBadRequest, CodeBadRequest, err.Error())
			},
		})
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeNotFound(w) })
	return r
}
