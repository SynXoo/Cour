# Cour

**A modern anime tracking & discussion platform — seasonal-first, recency-aware, community-driven.**

> A *cour* is a ~13-episode broadcast season. Cour is built around that rhythm: what's airing **now**, what's trending **this week**, and the episode thread everyone's in **tonight** — not a museum of all-time rankings.

🚧 **Under active construction.** This README grows with the build; see [docs/](docs/) for architecture, data model, and algorithm write-ups as they land.

## Quick start

```sh
docker compose up --build      # whole system: Postgres, Redis, API, worker, asynqmon, web
```

or for local development with hot reload:

```sh
go install github.com/go-task/task/v3/cmd/task@latest
task infra     # Postgres :5434, Redis :6380, asynqmon :8081
task api       # Go API on :8080
task worker    # asynq background worker
task web       # Next.js on :3000
```

## Stack

Go (chi · pgx · sqlc · asynq) + Next.js App Router (TypeScript · Tailwind · shadcn/ui · TanStack Query) + PostgreSQL + Redis. Anime metadata from the [AniList](https://anilist.co) GraphQL API.

## Repo layout

```
backend/   Go API + asynq worker + seed tooling
web/       Next.js frontend (SSR public pages, client app areas)
docs/      architecture, data model, algorithms, phase-2 plan
```
