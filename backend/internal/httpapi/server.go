// Package httpapi assembles the versioned REST API: routing, middleware,
// request/response conventions (error envelope, pagination), and handlers.
package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-redis/redis_rate/v10"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"cour/internal/auth"
	"cour/internal/cache"
	"cour/internal/catalog"
	"cour/internal/config"
	"cour/internal/discovery"
	"cour/internal/discussions"
	"cour/internal/httpapi/apigen"
	"cour/internal/lists"
	"cour/internal/mail"
	"cour/internal/notify"
	"cour/internal/profiles"
	"cour/internal/reviews"
	"cour/internal/social"
	"cour/internal/store/sqlcgen"
)

type Deps struct {
	Cfg   config.Config
	Log   *slog.Logger
	Pool  *pgxpool.Pool
	Redis *redis.Client
}

// apiServer composes the per-domain handler sets into the single
// apigen.ServerInterface the spec router expects.
type apiServer struct {
	catalogHandlers
	authHandlers
	listHandlers
	profileHandlers
	reviewHandlers
	discussionHandlers
	socialHandlers
	notificationHandlers
	discoveryHandlers
}

func NewRouter(d Deps) (http.Handler, error) {
	issuer, ephemeral, err := auth.NewTokenIssuer(d.Cfg.AuthTokenSeed, d.Cfg.AccessTokenTTL)
	if err != nil {
		return nil, err
	}
	if ephemeral {
		d.Log.Warn("AUTH_TOKEN_SEED is empty — using an ephemeral signing key; sessions will not survive restarts")
	}

	queries := sqlcgen.New(d.Pool)
	appCache := cache.New(d.Redis)
	mailer := mail.New(d.Cfg.EmailMode, d.Log)
	authSvc := auth.NewService(d.Pool, issuer, mailer, d.Cfg.RefreshTokenTTL, d.Cfg.WebOrigin, d.Log)

	// Async notification producer; discussions and follows fan out through it.
	enqueuer := notify.NewEnqueuer(d.Cfg.RedisAddr, d.Log)
	discussionSvc := discussions.New(d.Pool, d.Log)
	discussionSvc.SetNotifier(enqueuer)

	var discord *auth.Discord
	if d.Cfg.DiscordEnabled() {
		discord = auth.NewDiscord(
			d.Cfg.DiscordClientID,
			d.Cfg.DiscordSecret,
			d.Cfg.WebOrigin+"/api/v1/auth/discord/callback",
		)
		d.Log.Info("discord oauth enabled")
	}

	server := apiServer{
		catalogHandlers: catalogHandlers{
			svc: catalog.New(queries, appCache, d.Log),
			log: d.Log,
		},
		authHandlers: authHandlers{
			svc:     authSvc,
			discord: discord,
			rdb:     d.Redis,
			limiter: redis_rate.NewLimiter(d.Redis),
			cfg:     d.Cfg,
			log:     d.Log,
		},
		listHandlers: listHandlers{
			svc: lists.New(d.Pool, d.Log),
			log: d.Log,
		},
		profileHandlers: profileHandlers{
			svc: profiles.New(d.Pool, appCache, d.Log),
			log: d.Log,
		},
		reviewHandlers: reviewHandlers{
			svc: reviews.New(d.Pool, d.Log),
			q:   queries,
			log: d.Log,
		},
		discussionHandlers: discussionHandlers{
			svc: discussionSvc,
			log: d.Log,
		},
		socialHandlers: socialHandlers{
			svc: social.New(d.Pool, enqueuer, d.Log),
			q:   queries,
			log: d.Log,
		},
		notificationHandlers: notificationHandlers{
			q:   queries,
			log: d.Log,
		},
		discoveryHandlers: discoveryHandlers{
			svc: discovery.New(d.Pool, appCache, discovery.DefaultTrendingConfig(), d.Log),
			log: d.Log,
		},
	}

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

	r.Route("/api/v1", func(r chi.Router) {
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeNotFound(w) })
		r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusMethodNotAllowed, CodeBadRequest, "method not allowed")
		})

		r.Use(optionalAuth(issuer))
		// Coarse safety-net limit; credential endpoints add their own
		// strict per-IP limits on top.
		r.Use(rateLimit(d.Redis, "global",
			redis_rate.Limit{Rate: 25, Burst: 50, Period: time.Second}, byUser))

		apigen.HandlerWithOptions(server, apigen.ChiServerOptions{
			BaseRouter: r,
			// Parameter binding failures (bad enum, non-numeric id, ...)
			ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				writeError(w, http.StatusBadRequest, CodeBadRequest, err.Error())
			},
		})
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeNotFound(w) })
	return r, nil
}
