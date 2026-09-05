// Package httpapi assembles the versioned REST API: routing, middleware,
// request/response conventions (error envelope, pagination), and handlers.
package httpapi

import (
	"log/slog"
	"net/http"
	"net/url"
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
	"cour/internal/imports"
	"cour/internal/lists"
	"cour/internal/mail"
	"cour/internal/moderation"
	"cour/internal/notify"
	"cour/internal/parties"
	"cour/internal/profiles"
	"cour/internal/pulse"
	"cour/internal/realtime"
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
	pulseHandlers
	moderationHandlers
	importHandlers
	partyHandlers
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

	// Live thread layer: SSE fan-out bridged across instances by Redis pub/sub.
	realtimeHub := realtime.NewHub(d.Redis, d.Log)

	// Watch parties (M4): the WebSocket gateway rides the same pub/sub
	// plumbing under its own prefix. Built regardless of the flag (cheap: one
	// pattern subscription); the routes are what the flag gates.
	partySvc := parties.New(d.Pool, d.Log)
	partyGateway := realtime.NewPartyGateway(d.Redis, partySvc, socketAuthenticator(issuer), toPartyAny, socketOrigins(d.Cfg), d.Log)
	if d.Cfg.WatchParties {
		d.Log.Info("watch parties enabled")
	}
	if filter := moderation.FilterFromEnv(); filter != nil {
		discussionSvc.SetTextFilter(filter)
		d.Log.Info("profanity filter enabled")
	}

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
			svc:      discussionSvc,
			trending: discussions.NewTrending(d.Pool, appCache, realtimeHub, d.Log),
			hub:      realtimeHub,
			log:      d.Log,
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
		pulseHandlers: pulseHandlers{
			svc: pulse.New(d.Pool, d.Log),
			log: d.Log,
		},
		moderationHandlers: moderationHandlers{
			svc: moderation.New(d.Pool, d.Log),
			log: d.Log,
		},
		importHandlers: importHandlers{
			// The API process creates and commits jobs; processing happens
			// in the worker, so no AniList fetcher here — just the producer.
			svc: imports.New(d.Pool, nil,
				imports.NewEnqueuer(d.Cfg.RedisAddr, d.Log).ProcessJob,
				d.Cfg.DemoMode, d.Log),
			q:        queries,
			demoMode: d.Cfg.DemoMode,
			log:      d.Log,
		},
		partyHandlers: partyHandlers{
			enabled: d.Cfg.WatchParties,
			svc:     partySvc,
			gateway: partyGateway,
			log:     d.Log,
		},
	}

	r := chi.NewRouter()

	// Note: no RealIP/X-Forwarded-For handling here — trusting proxy headers
	// must be an explicit, deployment-aware decision (see rate limiting).
	r.Use(middleware.RequestID)
	r.Use(requestLogger(d.Log))
	r.Use(recoverer(d.Log))
	// The 30s request timeout is applied per-group below, not globally, so the
	// SSE stream can opt out — a timed-out context would tear it down every 30s.

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

		// Long-lived streaming endpoint: hand-routed (excluded from codegen)
		// and deliberately outside the request timeout so it owns its own
		// lifecycle, closing only when the client disconnects.
		r.Get("/threads/{threadId}/events", server.StreamThreadEvents)
		// The watch-party socket: same treatment, and only mounted when the
		// feature is on so it is a plain 404 dark.
		if d.Cfg.WatchParties {
			r.Get("/ws", server.PartySocket)
		}

		// Everything else keeps the 30s safety timeout.
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(30 * time.Second))
			apigen.HandlerWithOptions(server, apigen.ChiServerOptions{
				BaseRouter: r,
				// Parameter binding failures (bad enum, non-numeric id, ...)
				ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
					writeError(w, http.StatusBadRequest, CodeBadRequest, err.Error())
				},
			})
		})
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeNotFound(w) })
	return r, nil
}

// socketAuthenticator adapts the token issuer for the party gateway's
// first-frame auth (a browser can't set headers on a WebSocket handshake).
func socketAuthenticator(issuer *auth.TokenIssuer) realtime.Authenticator {
	return func(token string) (realtime.PartyUser, bool) {
		claims, err := issuer.ParseAccess(token)
		if err != nil {
			return realtime.PartyUser{}, false
		}
		userID, err := claims.UserID()
		if err != nil {
			return realtime.PartyUser{}, false
		}
		return realtime.PartyUser{ID: userID, Username: claims.Username}, true
	}
}

// socketOrigins is the WebSocket Origin allow-list: the configured web
// origin's host (the browser reaches the API through the Next rewrite, so the
// Origin header is the web app's, not the API's). A local stack — dev env, or
// a WEB_ORIGIN that is itself localhost, like the compose demo — also admits
// any localhost port, so a preview server on a random port can connect; a
// stack that is not internet-facing has nothing to defend there.
func socketOrigins(cfg config.Config) []string {
	origins := []string{}
	local := cfg.Dev()
	if u, err := url.Parse(cfg.WebOrigin); err == nil && u.Host != "" {
		origins = append(origins, u.Host)
		if h := u.Hostname(); h == "localhost" || h == "127.0.0.1" {
			local = true
		}
	}
	if local {
		origins = append(origins, "localhost:*", "127.0.0.1:*")
	}
	return origins
}
