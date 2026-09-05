# Architecture

```
                        ┌────────────────────────────── one origin ──────────────────────────────┐
 browser ── HTTP ──▶ Next.js (web)  ── rewrite /api/* ──▶  Go API (api) ──▶ PostgreSQL (truth)
                     SSR/RSC public pages                   chi + sqlc      │
                     TanStack Query + generated client      │               ├─▶ Redis ── caches, rate limits,
                                                            │               │          trending ZSET, oauth state
                                                            ▼               │
                                              asynq queue (Redis) ◀── enqueue (notifications)
                                                            ▲
                                                            │ consume + cron
                                            Go worker (worker) ──▶ AniList GraphQL (rate-limited)
                                            asynqmon (:8081) — queue dashboard
```

Five processes (`docker compose up`): **postgres**, **redis**, **api**,
**worker**, **web** (+ **asynqmon** for ops visibility).

## Split of responsibilities

- **Go API** — source of truth for *everything*: auth, validation,
  authorization, data access. Versioned REST under `/api/v1`, consistent
  error envelope `{"error":{code,message,details}}`, pagination on every
  list, OpenAPI-first (the spec generates both the chi server interfaces and
  the TS client).
- **Next.js** — SEO/SSR for public surfaces (home, seasonal charts, anime
  detail, profiles, reviews, threads) and a client-side app for authed
  surfaces (list, feed, notifications, recommendations, settings). It holds
  **no business logic**; it renders API responses.
- **Worker** — everything async: AniList sync, trending/gems recompute,
  notification fan-out, episode-aired cron. Same binary family, same Redis.

## Key decisions (and their tradeoffs)

### One origin via rewrite, not CORS
The browser only ever talks to the Next origin; `/api/*` is proxied to the
Go API. Cookies stay first-party, CORS never exists, and deploying behind
one domain is trivial. Tradeoff: an extra proxy hop for API calls (negligible
at this scale; server components skip it by calling the API directly).

### Auth: short JWT + rotating refresh cookie
Access tokens are 15-minute Ed25519 JWTs held **in memory** client-side;
the refresh token is an opaque 256-bit value in an httpOnly SameSite=Lax
cookie scoped to `/api/v1/auth`, stored server-side as a sha256 digest in a
**token family**. Every refresh rotates; replaying a rotated token revokes
the whole family (theft response — verified in the repo history). Password
resets revoke all families. Cookie-authenticated endpoints additionally
require a custom `X-Requested-With` header (CSRF belt over the SameSite
suspenders). Multi-instance: any instance can verify (shared Ed25519 seed)
— no session affinity.

### Spec-first API contract
`backend/api/openapi.yaml` is the contract. `oapi-codegen` generates the chi
server interface (params parsed and typed before handlers run);
`openapi-typescript` + `openapi-fetch` generate the TS client. A field that
changes without regeneration fails compilation on both ends. Tradeoff:
spec-editing discipline — accepted for the cross-language type safety.

### The activity spine
Every meaningful action writes an `activities` row **in the same
transaction** as the action. That one append-only stream feeds both the
follow feed and trending — no event bus to operate, no double-write drift.
The seam to a real bus (if this outgrew Postgres) is a single insert site.

### Feed fan-out
**Fan-out-on-read**: the feed is one keyset-paginated query over followees'
activities. At portfolio scale (small median follow counts) write-side
fan-out buys nothing and costs storage, repair jobs, and consistency edges.
**Upgrade path** (documented, not built): asynq fan-out-on-write to capped
per-user Redis lists (~800 entries), celebrities excluded (read-merge),
backfill on follow. The read query keeps working during any migration.

### Caching
Cache-aside JSON in Redis with explicit invalidation where writes happen
(anime detail on sync, profiles on edit) and generation-counter keys where
ranges make enumeration impossible (schedule windows). Trending is not a
cache — the ZSET *is* the serving datastructure, replaced atomically by the
job. TTLs: detail 1 h, seasonal/schedule 6 h, profiles 5 m, recs 6 h.

### Rate limiting
Redis GCRA (`redis_rate`): coarse per-user/IP limit on all of `/api/v1`
(25 rps burst 50), strict 5/min/IP on credential endpoints. Fails **open**
(Redis outage must not take reads down). Client IP = socket address only —
proxy headers are spoofable and deliberately ignored until a deployment
declares a trusted proxy. The AniList client has its own token bucket
(~27 req/min, under the degraded 30/min limit) + `Retry-After` compliance.

### AniList sync as a subsystem
`internal/anilist` owns the upstream: typed GraphQL client (rate-limited,
retrying), paginated season/trending/airing sync jobs with bounded pages,
idempotent upserts keyed on `anilist_id`, cache invalidation on write, and a
**committed fixtures snapshot** so `DEMO_MODE=1` runs the entire product
with zero external calls. Failure mode: caches serve stale, jobs retry with
backoff — user-facing reads never block on AniList.

The full catalog (~20k titles) is mirrored once by a **backfill crawl**.
AniList caps offset pagination at 5,000 entries per query and has no id or
updatedAt range filters, so the crawl partitions the catalog into windows
that each fit under the cap (status windows for date-less entries, then
startDate ranges: decades through 1979, yearly after). It runs in ~10-page
chunks, each chunk an asynq task that chains the next, with the
window/page cursor checkpointed in `sync_state` so restarts resume mid-crawl
(~20 min of API time end to end). After that, an **incremental refresh**
(every 6h) walks the `UPDATED_AT_DESC` feed down to a persisted watermark,
picking up new announcements and upstream edits for a handful of requests
per tick; if an edit spike overflows a tick's page budget, the watermark
advances to the oldest edit actually seen, so progress is monotonic and
later ticks converge. Season/trending/airing jobs remain the fast path for
the current cour.

### Search
Postgres-native: weighted generated tsvector (`simple` config — titles are
names, stemming hurts) + `pg_trgm` GIN for typo tolerance, blended rank
(`ts_rank` ⊕ trigram similarity). One less service to run; behind a service
seam if Meilisearch ever earns its ops cost. Tradeoff: weaker CJK
tokenization — acceptable for title search where romaji/english dominate
queries.

### Observability
Structured `slog` everywhere (request logs with request-id, status-leveled),
`/healthz` (liveness) and `/readyz` (dependency pings), asynqmon for queue
depth/failures. Metrics endpoint is a deliberate omission at this scale;
the request logs are structured enough to derive rates.

## Repo layout

```
backend/
  cmd/{api,worker,seed,anilist-snapshot}   binaries
  api/openapi.yaml                         the contract
  internal/
    httpapi/      handlers + middleware + generated server (apigen/)
    auth/ mail/ notify/                    identity + async side effects
    catalog/ lists/ reviews/ discussions/ profiles/ social/   domains
    discovery/                             trending / gems / recs
    anilist/                               upstream client + sync + fixtures
    jobs/                                  asynq registration + schedule
    store/ (sqlcgen/) cache/ config/ logging/
    realtime/                              live layer: SSE thread hub + party WebSocket gateway (Redis pub/sub bridged)
    parties/                               watch-party rooms (M4)
  migrations/  queries/                    schema + sqlc sources
web/
  app/          App Router routes (SSR public, client authed)
  components/   ui/ (shadcn) + domain components
  lib/          generated api client, session, hooks
docs/           this directory
```
