# Cour — seasonal-first anime tracking & discussion

Go 1.25 + Next.js 16 monorepo (`backend/`, `web/`). Phase 1 complete;
Phase 2 in progress — **roadmap and task ledger: `docs/PHASE_2.md`**.

## "Next feature" workflow (Phase 2 sessions)

When asked to work on the next feature/task:

1. Open `docs/PHASE_2.md` → **Progress ledger**. Take the first unchecked
   task unless one is named. Scan the Session log for notes from prior
   sessions.
2. Read that task's milestone section (same file) — it is the spec.
3. Follow the **Session protocol** there: implement, test, verify, check
   the box, append a Session log line, commit as `M<x>.<y>: <summary>`.
4. Stay on the one task. New ideas go to the doc's Parking lot, not the
   diff. Plan-changing decisions get edited into the doc.

## Run

- Everything: `docker compose up --build` — pg :5434 · redis :6380 ·
  api :8080 · web :3000 · asynqmon :8081 (5433 belongs to another project)
- Native dev: `task infra`, then `task api` / `task worker` / `task web`
- Seed demo world: `task seed` (in Docker:
  `docker compose exec api //usr/local/bin/seed` — double slash defeats
  Git Bash path mangling)
- Demo login: `sakuga_sam@cour.demo` / `cour-demo-2026` (any `*@cour.demo`
  user, same password). `DEMO_MODE=true` = fully offline, fixtures only.
- Browser preview: launch config `cour-web` (wrapper `scripts/dev-web.ps1`).

## Codegen & tests — spec-first is law

- New/changed endpoint ⇒ edit `backend/api/openapi.yaml` **first**; schema
  change ⇒ migration + `backend/queries/*.sql`; then `task gen`
  (sqlc + oapi-codegen + openapi-typescript). CI fails on drift, so commit
  regenerated files with the change that caused them.
- `task test` (Go unit + web vitest) · `task test:int` (testcontainers,
  needs Docker) · `task lint` (golangci-lint + eslint + tsc).
- **PATH quirk:** `task`, `sqlc`, `oapi-codegen`, `golangci-lint` live in
  `~\go\bin`, which is NOT on PATH in Claude Code shells. PowerShell:
  `& "$env:USERPROFILE\go\bin\task.exe" test` · Git Bash:
  `~/go/bin/task test`.

## Landmines

- **Zero-activity rule for bulk writes** (imports etc.): never loop the
  per-entry service methods — `activities` rows feed the follow feed *and*
  Trending Now, so bulk inserts must bypass activity writes
  (see `docs/PHASE_2.md` §M1).
- No streams, ever: Cour never hosts, proxies, or links to video.
- Next.js 16 differs from training data — read the guides in
  `web/node_modules/next/dist/docs/` before nontrivial Next work
  (`web/AGENTS.md`).

## Docs

`docs/ARCHITECTURE.md` · `docs/DATA_MODEL.md` (ERD) · `docs/ALGORITHMS.md`
(trending/gems/recs formulas) · `docs/PHASE_2.md` (roadmap + ledger) ·
`docs/WATCH_PARTIES.md` (M4 design) · `docs/DEPLOY.md`
