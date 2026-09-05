# Deployment notes

Cour is three containers (api, worker, web) plus managed Postgres and Redis.
Both target platforms below give you the datastores as add-ons; the images
are the ones `docker compose build` produces (distroless Go, standalone
Next).

## Environment

| var | api | worker | web | notes |
|---|---|---|---|---|
| `COUR_ENV` | `prod` | `prod` | — | enables Secure cookies, JSON logs |
| `DATABASE_URL` | ✓ | ✓ | — | managed Postgres URL |
| `REDIS_ADDR` | ✓ | ✓ | — | `host:port` |
| `AUTH_TOKEN_SEED` | ✓ | ✓ | — | **required in prod** — `openssl rand -base64 32`; same value on every instance |
| `AUTO_MIGRATE` | `true` | — | — | or run `api -migrate-only` as a release step |
| `WEB_ORIGIN` | ✓ | — | — | public site URL (email links, OAuth redirects) |
| `DISCORD_CLIENT_ID/SECRET` | ✓ | — | — | optional; button hides when absent |
| `DEMO_MODE` | opt | opt | — | `true` = no AniList calls |
| `FEATURE_WATCH_PARTIES` | opt | — | — | `true` mounts `/parties` + the `/ws` gateway (off by default; the local compose stack turns it on) |
| `API_INTERNAL_URL` | — | — | ✓ | private URL of the api service |
| `TRENDING_*` | — | opt | — | algorithm tuning (see `.env.example`) |

Discord OAuth redirect URI to register: `{WEB_ORIGIN}/api/v1/auth/discord/callback`.

## Railway

1. Create a project; add **PostgreSQL** and **Redis** plugins.
2. Three services from this repo:
   - **api** — root `backend`, Dockerfile target `api`. Health check `/readyz`.
   - **worker** — root `backend`, target `worker` (no public networking).
   - **web** — root `web`. Expose; this is the public service.
3. Wire env per the table (Railway injects `DATABASE_URL`/`REDIS_URL` — map
   `REDIS_URL` host:port into `REDIS_ADDR`).
4. Set `API_INTERNAL_URL` on web to the api service's private URL
   (`http://api.railway.internal:8080`).
5. First deploy: run the seed once —
   `railway run --service api go run ./cmd/seed` (or exec the seed binary in
   the image) — or set `DEMO_MODE=false` and let the worker's bootstrap sync
   pull the current seasons within a few minutes and backfill the full
   catalog (~20k titles) in the background over the following half hour.

## Fly.io

One app per service (`fly.toml` per directory), same images:

- `fly postgres create` + `fly redis create` (Upstash), attach both to api
  and worker.
- api: `internal_port 8080`, health check `GET /readyz`; scale ≥1.
- worker: no services block (no ports), scale 1 (the schedulers assume a
  single scheduler instance; asynq handles concurrent *workers* fine — if
  you scale workers, run exactly one instance with the scheduler enabled).
- web: `internal_port 3000`, public; `API_INTERNAL_URL` via Flycast
  (`http://api.flycast:8080`).
- Secrets via `fly secrets set` (never in fly.toml).

## Release checklist

- [ ] `AUTH_TOKEN_SEED` set (and identical) on api + worker.
- [ ] Migrations applied (`AUTO_MIGRATE=true` or `-migrate-only` release step).
- [ ] `/readyz` returns 200 with both deps `ok`.
- [ ] asynqmon (bind privately!) shows the cron entries registered.
- [ ] `WEB_ORIGIN` matches the real domain; Discord redirect registered.
- [ ] Next `images.remotePatterns` covers the AniList CDN (already in repo).

## Scaling notes

- **api** is stateless — scale horizontally freely.
- **worker**: task handlers are safe to scale; the *scheduler* must run
  once. (Split `-scheduler-only` flag out if worker count > 1.)
- Postgres is the bottleneck long before Redis; the indexes are documented
  in DATA_MODEL.md and every hot path is keyset-paginated.
