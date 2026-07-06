# Cour

**A modern anime tracking & discussion platform — seasonal-first, recency-aware, community-driven.**

> A *cour* is a ~13-episode broadcast season. Cour is built around that
> rhythm: what's airing **now**, what's trending **this week**, and the
> episode thread everyone's in **tonight** — not a museum of all-time
> rankings.

## Why

MyAnimeList's rankings freeze the 2010s in amber: all-time popularity buries
whatever people are actually watching this season. Cour inverts that bias at
every layer:

- **Seasonal charts** are a primary surface, not a submenu.
- **Trending Now** is computed from *recent* user activity with exponential
  time decay — hype has to be current to count
  ([formula & weights](docs/ALGORITHMS.md)).
- **The weekly schedule** deep-links every airing episode into its own
  discussion thread — the watch-along ritual, async.
- **Timestamped comments** anchor reactions to a moment ("@ 12:34 — that
  cut"), with spoiler blur everywhere.
- **Recommendations** come from users with your taste (Jaccard neighbor
  overlap), biased toward the current season, each pick explained:
  *"Because you liked X."*
- **Hidden gems** surfaces recent, highly-rated, under-watched titles — the
  literal inversion of the popularity chart.

No streams, ever: Cour synchronizes *people* (threads today, live watch
parties in [Phase 2](docs/WATCH_PARTIES.md)); everyone brings their own
legal source.

## Quick start

```sh
docker compose up --build     # postgres + redis + api + worker + asynqmon + web
```

Then seed the demo world (catalog fixtures + 25 users with lists, reviews,
threads, follows — no external calls needed):

```sh
docker compose exec api /usr/local/bin/seed   # or natively: task seed
```

Open http://localhost:3000 — sign in as `sakuga_sam@cour.demo` /
`cour-demo-2026` (any `*_@cour.demo` user, same password).

### Local development (hot reload)

```sh
go install github.com/go-task/task/v3/cmd/task@latest
task infra     # postgres :5434, redis :6380, asynqmon :8081
task seed      # fixtures + demo world
task api       # Go API :8080
task worker    # asynq worker + cron scheduler
task web       # Next.js :3000
```

`task --list` shows the rest (`gen`, `test`, `test:int`, `lint`, …).
Everything runs with zero config; `.env.example` documents every knob.
`DEMO_MODE=true` disables all AniList calls (the committed fixture snapshot
carries the catalog).

## Architecture

```
 browser ──▶ Next.js 16 (web)          ── /api/* rewrite ──▶  Go API (chi) ──▶ PostgreSQL 17
             SSR public pages (SEO)                            │    │
             TanStack Query + generated TS client              │    └──▶ Redis 8 ── cache · rate limits
                                                               ▼              trending ZSET · queue
                                                    asynq queue/cron
                                                               ▲
                                            Go worker ─────────┘──▶ AniList GraphQL (rate-limited)
```

- **Spec-first API**: [`backend/api/openapi.yaml`](backend/api/openapi.yaml)
  generates the chi server interfaces (oapi-codegen) *and* the typed TS
  client (openapi-typescript) — a contract change that isn't regenerated
  fails compilation on both ends (CI enforces sync).
- **Auth**: argon2id passwords, 15-min Ed25519 JWTs in memory, rotating
  refresh-token families in httpOnly cookies with **replay-detection**
  (reusing a rotated token revokes the family), optional Discord OAuth.
- **The activity spine**: every action writes an `activities` row in the
  same transaction; that one stream powers both the follow feed
  (fan-out-on-read) and trending.
- **AniList sync** is a first-class subsystem: token-bucket rate limiting,
  `Retry-After` compliance, paginated idempotent upserts, committed fixtures
  for offline demo, stale-serving caches when the upstream is down.
- **Search**: Postgres FTS (weighted tsvector) blended with trigram
  *word* similarity — `friren` finds *Sousou no Frieren*.

Deep dives: [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[DATA_MODEL + ERD](docs/DATA_MODEL.md) · [ALGORITHMS](docs/ALGORITHMS.md) ·
[PHASE_2 roadmap](docs/PHASE_2.md) ·
[WATCH_PARTIES](docs/WATCH_PARTIES.md) · [DEPLOY](docs/DEPLOY.md)

## Stack

| | |
|---|---|
| API | Go 1.25 · chi · pgx + sqlc · golang-migrate (embedded) · asynq · slog |
| Web | Next.js 16 (App Router, RSC) · TypeScript · Tailwind 4 · shadcn/ui · TanStack Query · react-hook-form + zod |
| Data | PostgreSQL 17 (source of truth) · Redis 8 (cache, rate limits, queue, trending) |
| Upstream | AniList GraphQL (attributed in-app) |
| Testing | testify unit tests on all core logic · **testcontainers-go** integration suite (real PG+Redis over HTTP) · vitest + Testing Library |
| Ops | multi-stage Dockerfiles (distroless Go, standalone Next) · docker compose · GitHub Actions (lint, tests, codegen drift, docker builds) · asynqmon |

## Features (Phase 1 — complete)

Auth (email + Discord, verification, reset) · catalog browse/fuzzy
search/detail · lists with score/progress/auto-complete · public SSR
profiles with stats & genre breakdowns · long-form reviews with spoiler blur
+ helpful votes · series boards + per-episode threads with timestamped
comments & reactions · follows + activity feed · notifications (replies,
followers, new-episode alerts via cron) · seasonal charts · weekly release
hub · Trending Now · hidden gems · explainable recommendations · moderation
(reports, soft-delete tombstones, mod roles, profanity hook) · Redis rate
limiting · demo mode.

**Phase 2 — planned:** live episode threads (streaming comments + presence),
progress-aware spoiler safety, MAL/AniList list import, a "Tonight on Cour"
home + logged-out landing, a mobile/layout pass, and real-time watch
parties — roadmap in [docs/PHASE_2.md](docs/PHASE_2.md), party protocol in
[docs/WATCH_PARTIES.md](docs/WATCH_PARTIES.md).

## License / data

Anime metadata © their respective owners, served via the
[AniList API](https://docs.anilist.co/) and attributed in-app. Cour hosts no
video and links to no streams.
