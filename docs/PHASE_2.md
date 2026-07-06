# Phase 2 — the season, live

Phase 1 built a complete tracker with discussion bones. The honest critique
of the result: **it works like Cour but feels like MAL** — you log in, see a
seasonal chart, update your list, leave. Phase 2's job is not more features;
it is making Cour the place you open *tonight because something is
happening*, and making that obvious within ten seconds of landing on it.

The watch-party protocol design that used to live in this file moved intact
to [WATCH_PARTIES.md](WATCH_PARTIES.md) — it is now milestone **M4** of this
plan.

---

## Progress ledger

One task = one chat/session. **Session protocol:**

1. **Start** — take the first unchecked task (or the one the user names).
   Read its milestone section below: that is the spec. Scan the Session
   log for notes left by earlier sessions.
2. **During** — stay on the task. New ideas → [Parking lot](#parking-lot).
   Decisions that change the plan → edit the relevant section in place.
3. **Done means** — tests pass (`task test`; `task gen` clean when
   spec/schema touched), UI work verified in the preview at mobile *and*
   desktop widths, box checked, one Session log line appended, committed
   as `M<x>.<y>: <summary>`.

Model hints: **F** = Fable (design-heavy, pattern-setting) ·
**O** = Opus/Sonnet (spec is precise; execution work).

### M0 — polish

- [ ] **M0.1** (O) Flash fix — reproduce against a *prod* build first
  (hypothesis A vs B, §M0); then delayed `Skeleton` (~150 ms),
  `keepPreviousData` on `/list` tabs, SSR-prefetch the first list tab.
- [ ] **M0.2** (O) Layout widths — per-surface `PageShell` (browse ~88 rem /
  reading `max-w-3xl` / forms narrow), `AnimeGrid` auto-fill columns,
  header tracks the widest shell.
- [ ] **M0.3** (F) Mobile foundation — bottom tab bar (Home · Seasonal ·
  Search · My list · Menu), header collapse on mobile, safe-area insets,
  toaster to top-center on mobile.
- [ ] **M0.4** (O) 375 px audit — episode-thread header, composer row, tap
  targets ≥ 44 px, grids; fix what the sweep finds; verify at
  375/768/1024/1440/2560, light + dark.
- [ ] **M0.5** (O) Seasonal controls — client-side sort
  (popularity/score/title/weekday/newest) + genre/format/weekday filter
  chips, URL-synced; flatten format groups on any non-default view;
  schedule page "my shows" toggle.

### M1 — import

- [ ] **M1.1** (O) `mal_id` — nullable-unique migration, `idMal` through the
  AniList query/mapper/fixtures, then kick off the backfill re-crawl (it
  runs for hours under the rate budget — start it and let it finish
  outside the session).
- [ ] **M1.2** (F) Import backend — openapi endpoints, `import_jobs` table,
  asynq pipeline, matching (ids → trigram fallback → review bucket),
  score/status conversion, **zero-activity bulk apply + the
  trending-unchanged regression test**.
- [ ] **M1.3** (O) Import UI — Settings → Import, AniList username + MAL XML
  upload, ~2 s status polling, preview → review → commit screens
  (merge | overwrite).

### M2 — live thread layer

- [ ] **M2.1** (F) SSE gateway — rewrite-streaming spike FIRST;
  `internal/realtime` hub + Redis pub/sub; `GET /threads/{id}/events`
  (comment/reaction/presence events); publish-on-commit from the
  discussions service; integration test.
- [ ] **M2.2** (F) Live client — `useThreadEvents` merging into the React
  Query cache, slide-in comments, "N new comments" pill when scrolled,
  presence badge (shows at ≥ 2), polling degrade on error,
  `prefers-reduced-motion`.
- [ ] **M2.3** (O) Velocity + spoiler guard — `comments(created_at)` index,
  `GET /threads/trending` (decay + presence bonus, 60 s cache),
  progress-aware banner/blur on episode threads, inline "mark ep N
  watched". Stretch: night-of badge, bell 60 s refetch.

### M3 — home & landing

- [ ] **M3.1** (F) Landing + routing — `cour_refresh` cookie branch in
  `app/page.tsx`, hero, live-proof ticker, tonight strip, seasonal
  preview, no-streams promise, SEO metadata.
- [ ] **M3.2** (O) "Tonight on Cour" — your-evening row, live-now threads,
  continue-watching, the season's conversation, compact existing strips.
- [ ] **M3.3** (O) Onboarding + threads hub — post-register pick-your-shows
  + import CTA, `/threads` page (tonight / busiest this week), nav
  updates on desktop + bottom bar.

### M4 — watch parties ([design](WATCH_PARTIES.md))

- [ ] **M4.1** (F) WS gateway + presence, flag-gated
- [ ] **M4.2** (F) Shared clock — host controls, drift correction
- [ ] **M4.3** (O) Live chat + reactions + opt-in persistence into threads
- [ ] **M4.4** (O) Room lifecycle + discovery (episode page, schedule, home)

### Session log

<!-- One line per completed session: date · task · outcome / notes for the next session. -->

- 2026-07-06 · plan · Roadmap + ledger written; watch-party design moved to WATCH_PARTIES.md; sqlc drift committed. Nothing implemented yet.

### Parking lot

<!-- Mid-session ideas land here instead of in the diff. -->

---

## The thesis: the tracker powers the conversation

MAL and AniList are databases with forums bolted on. Reddit has the episode
threads but knows nothing about you. Discord is alive but ephemeral and a
spoiler minefield. Cour's structural advantage is that it already holds both
halves: **per-episode threads with timestamped comments** and **your exact
watch progress** — nobody else connects them. Phase 2 connects them, three
ways:

1. **Live canonical episode threads.** One permanent thread per episode
   that *feels alive*: comments stream in without refresh, a presence count
   ("14 here now"), reaction ticks. Live on airing night; a replayable
   record forever after (the timeline sort already replays an episode's
   reactions in moment order).
2. **Progress-aware spoiler safety.** Cour knows you're on episode 7, so
   the episode 9 thread warns and blurs before you scroll. The tracker
   stops being the product and becomes the *safety infrastructure for
   talking about anime* — the thing Reddit structurally cannot do.
3. **The week as the home page.** Logged in, the home page answers
   "what's happening tonight in my season": your airing shows, the threads
   that are busy right now, what you're behind on. Logged out, a landing
   page proves the site is alive instead of claiming it.

Everything below serves that thesis. The features that don't (extension,
OAuth sync, polls) are explicitly deferred at the bottom.

### The room-model decision

Considered: capped live rooms that users join/leave, with spectators
(à la Discord stages). **Rejected in favor of one canonical thread per
episode, live-by-presence.** Reasons:

- **Cold start is the #1 risk.** Splitting 12 active users across three
  rooms makes everything look dead. One thread concentrates all heat.
- **The thread doubles as the artifact.** Live comments land in the same
  permanent, timestamped record late watchers replay next month. Separate
  chat rooms would compete with the threads instead of feeding them.
- **Spectating needs no mechanics** — it's called reading. Presence is a
  count, not a membership.
- Text threads don't need capacity management until thousands of
  *concurrent posters* (a great problem for later; slow-mode and
  wave-sharding are the known answers).

Small synchronized groups are a *different job* — a shared playback clock —
and that is [watch parties (M4)](WATCH_PARTIES.md), opt-in rooms whose
reactions persist back into the canonical thread.

---

## Milestones

| # | Name | Size¹ | Depends on |
|---|---|---|---|
| M0 | Polish: flash glitch, layout widths, mobile, seasonal controls | M | — |
| M1 | List import (AniList + MAL) | M | — |
| M2 | The live thread layer (SSE, presence, spoiler guard) | M–L | — |
| M3 | Home ("Tonight on Cour") + logged-out landing + onboarding | M | M2 signals |
| M4 | Watch parties | L | M2 gateway |

¹ S ≈ a session, M ≈ 2–4 sessions, L ≈ 4+.

Order rationale: daily-feel fixes first (M0 also rebuilds the mobile/layout
foundation every later UI sits on), then the adoption funnel (M1 — nobody
switches trackers without their history), then the differentiator (M2), then
the showcase built from M2's signals (M3), then the synchronous cherry (M4).
M1 and M2 are independent and can swap or interleave. Each milestone ships
alone.

---

## M0 — polish

### The "table flash" on first navigation

Symptom: first time a page like a profile or a My-list tab is opened, a
table-like grid flashes for a couple of frames. Two candidate causes — first
step is telling them apart by reproducing against a **production build**
(`docker compose up web` runs the standalone build; dev `task web` does not
count):

- **Hypothesis A — dev-only FOUC.** Next dev compiles routes on demand and
  can paint semantic HTML before the route's CSS chunk arrives; unstyled
  stat cards / list rows render as a browser-default "table" for a frame.
  If the flash disappears in the prod build, it's this, and it's a
  dev-server artifact, not a product bug (document, revisit on Next
  upgrades).
- **Hypothesis B — skeleton flash.** `my-list-client.tsx` (and other
  client-fetch pages) swap in stacked skeleton rows during `isLoading`;
  on a fast API the skeletons show for ~2 frames — reads as a gray table.
  First open only, because React Query caches afterwards.

Fixes worth doing regardless of which hypothesis wins:

- Tab switches on `/list` use `placeholderData: keepPreviousData` — never
  skeleton between tabs.
- **Delayed skeletons** everywhere: skeletons mount invisible and fade in
  after ~150 ms (CSS `animation-delay` on the `Skeleton` component), so
  sub-150 ms loads never flash. One component change fixes every page.
- SSR-prefetch the first `/list` tab (React Query `HydrationBoundary`) so
  the signed-in list page arrives populated.

### Layout widths (the "big margins" question)

The current `max-w-6xl` (1152 px) shell on every page
([`web/app/layout.tsx:44`](../web/app/layout.tsx)) is a *reading-measure*
default — correct for prose, wasteful for poster grids on wide screens, and
ironically **too wide** for comment threads (1100 px text lines are hard to
read). Replace the one-size shell with per-surface widths via a `PageShell`
(or route-group layouts):

| Surface | Width |
|---|---|
| Browse: home, seasonal, schedule, trending, hidden-gems, search | `max-w-[88rem]` (~1400 px) |
| Reading: threads, reviews, feed | `max-w-3xl` comment column |
| Forms: auth, settings | narrow (unchanged) |

`AnimeGrid` switches to `auto-fill` column sizing so wider shells yield
*more columns*, not stretched cards. Header container tracks the widest.

### Mobile pass

The site renders on mobile but wasn't designed for it (nav is a cramped
scrolling row of six links). The pass:

- **Bottom tab bar** (mobile only): Home · Seasonal · Search · My list ·
  Menu — the app-like pattern, thumb-reachable, with safe-area insets.
  Header collapses to logo + bell + avatar.
- Audit at 375 px: episode-thread header (title + prev/next wraps badly),
  composer control row, dropdown/tap targets ≥ 44 px, toaster moves
  top-center on mobile (bottom-right collides with the tab bar).
- Verification matrix: 375 / 768 / 1024 / 1440 / 2560, light+dark.

### Seasonal sort & filter

The season payload already arrives complete (a season is a few hundred
titles), so controls are client-side and instant, synced to URL params for
shareable views (`?sort=score&genre=Action&day=friday`):

- **Sort:** popularity (default) · score · title · airing weekday · newest.
- **Filter chips:** format group, genre (from `anime.genres`), airing
  weekday.
- Default view keeps today's TV/Movies/OVA grouping; any non-default sort
  or filter flattens to one grid (groups don't survive re-sorting).
- Schedule page gets a "my shows only" toggle (client join against the
  viewer's list).
- Tags (`anime.tags` jsonb) are deliberately *not* a filter yet — genres
  cover most of the value; ranked-tag UX is a backlog item.

---

## M1 — list import (AniList + MAL)

Nobody switches trackers without their history. Import is the funnel.

### Sources, in order of build

1. **AniList by username** — public GraphQL `MediaListCollection`, no OAuth
   needed for public lists. Rows map by `anilist_id` (near-100 % hit rate:
   the catalog *is* an AniList mirror).
2. **MAL export upload** — the official XML export (`.xml`/`.gz`) every MAL
   account can download. Works for dead accounts, needs no API key.
   Requires MAL-id mapping (below). MAL OAuth live-sync: deferred.

### Schema/sync prerequisite: `mal_id`

`anime` currently stores only `anilist_id`
([`000002_catalog.up.sql`](../backend/migrations/000002_catalog.up.sql)).
AniList's `Media.idMal` provides the mapping for free:

- Migration: `ALTER TABLE anime ADD COLUMN mal_id INTEGER UNIQUE` (nullable).
- AniList query/mapper/fixtures gain `idMal`; upserts populate it.
- One-shot backfill re-crawl using the existing windowed-backfill machinery
  (`sync_state`); it's a full 22 k-title pass under the AniList rate
  budget, so kick it off early in the milestone and let the 6-hourly delta
  keep it fresh after. Titles where `idMal` is null fall back to matching.

### Pipeline

```
POST /import/anilist {username}          → import job (asynq)
POST /import/mal     (multipart XML)     → import job (asynq)
GET  /import/jobs/{id}                   → status + match preview
POST /import/jobs/{id}/commit {mode}     → apply
```

- `import_jobs` table: user, source, status, parsed+matched rows (jsonb),
  counts — durable, resumable, debuggable. Cap ~10 k rows, one live import
  per user (rate limit).
- **Matching:** by `anilist_id` / `mal_id`; misses fall back to
  normalized-title match (romaji/english/synonyms via the existing trigram
  search) auto-accepted only with high similarity + format/year agreement;
  the rest land in a "needs review" bucket the UI resolves with the
  existing search picker.
- **Preview → commit:** the UI shows *matched / needs review / conflicts*
  before anything is written. Modes: **merge** (default; skip titles
  already on the local list) or **overwrite** (import wins on
  status/score/progress).
- Status mapping: MAL `On-Hold`→`paused`, `Plan to Watch`→`planning`;
  AniList `REPEATING`→`completed` (Cour has no rewatch concept; don't lose
  the completion). Scores: MAL 1–10 direct; AniList by format
  (100-point → ÷10 rounded, 10-decimal → rounded, 5-star → ×2,
  3-smiley → {3, 6, 9}); 0/null → unscored.

### The zero-activity rule (critical)

Imports **must not write per-title `activities` rows**. The activity spine
feeds both the follow feed and trending; a 900-entry import posting 900
fresh `list_add` events would flood followers and poison Trending Now for
days. The apply step uses a dedicated bulk store path (one transaction, no
activity writes — *not* a loop over the per-entry service method). Guard it
with a regression test: *importing 500 entries leaves the trending ranking
unchanged and the feed silent.*

### UI

Settings → **Import** section, plus the post-register onboarding CTA (M3).
Progress polls the job status every ~2 s (no SSE dependency — M1 may land
before M2).

---

## M2 — the live thread layer

The differentiator milestone: threads stop being fetch-once pages.

### Transport: SSE, not WebSocket

One new endpoint: `GET /api/v1/threads/{id}/events` (Server-Sent Events).
Events: `comment.created` (full payload), `comment.deleted`,
`reaction.updated {comment_id, emoji, count}`, `presence {count}`. Posting
stays plain REST.

Why SSE: the flow is strictly server→client (posts are REST anyway), native
`EventSource` gives reconnect for free, it's plain HTTP so it rides the
existing Next `/api/*` rewrite with no new auth surface (public threads are
public to read — no token in the stream URL), and it keeps the WebSocket
budget for M4 where bidirectional actually matters (clock control).

**Spike first (de-risk):** confirm the Next rewrite streams
`text/event-stream` unbuffered in dev *and* the standalone prod build.
Fallback if proxying misbehaves: expose the events route directly /
degrade to 15 s polling — the client wrapper (below) isolates the choice.

### Backend shape

- `backend/internal/realtime`: per-thread subscriber registries on each
  instance; fan-out via Redis pub/sub `thread:{id}` so any instance serves
  any thread (same pattern M4's rooms will reuse). The discussions service
  publishes after commit.
- **Presence = the connection count.** No heartbeats needed — an SSE
  connection *is* presence. In-memory per instance, summed across
  instances via Redis only when there is more than one instance (compose
  runs one; keep the interface swappable, not the implementation).
- **Thread velocity:** add a `comments (created_at)` index; “busy threads”
  = comments in the recent window with the discovery package's decay shape
  + a presence bonus, served by `GET /threads/trending` with a ~60 s Redis
  cache. No new cron until scale demands it. Powers M3's home page and the
  `/threads` hub.

### Client shape

- `useThreadEvents(threadId)` wrapper around `EventSource` that merges
  events into the React Query cache (`setQueryData` append) and degrades
  to interval refetch on error.
- New comments slide in; if the reader has scrolled into the thread, an
  anchored **"N new comments" pill** instead of yanking scroll. Reaction
  counts tick in place. Presence badge ("14 here now") appears at ≥ 2.
  All motion respects `prefers-reduced-motion`.

### Progress-aware spoiler guard

On an episode-N thread, if the signed-in viewer's list entry has
`progress < N`: a banner ("you're 2 episodes behind") and **blur-all by
default** with per-comment or reveal-all override. Client-side against the
already-loaded list entry — no schema change. Companion feature: when
episode N is the viewer's *next* episode, the thread shows an inline
**"mark ep N watched"** button (existing upsert) — discussing and tracking
close into one loop.

Per-comment episode-scope tags on *series* boards: considered, deferred —
complexity outweighs return while episode threads carry the live traffic.

### Stretch (cheap, in-theme)

- **Night-of badge**: comments posted within 24 h of `episodes.airing_at`
  get a subtle marker — the ritual stays visible in the permanent record.
  Computable at render; no schema change.
- Notification bell: interim 60 s `refetchInterval` (it currently fetches
  once per mount); a user-scoped SSE channel is future work on the same
  pub/sub spine.

---

## M3 — home & landing

### Routing

`app/page.tsx` branches server-side on `cookies().has("cour_refresh")`
(cookie name: [`backend/internal/httpapi/auth.go:20`](../backend/internal/httpapi/auth.go)) —
presence of the refresh cookie ≈ signed in. It's a heuristic (an expired
cookie renders the authed shell whose islands resolve to anon and bounce to
the landing view client-side); acceptable, and it keeps the landing page
fully static-cacheable.

### Logged-in home — "Tonight on Cour"

Server shell + client islands, top to bottom:

1. **Your evening** — episodes airing in the next 24 h from the viewer's
   *watching* list, each with countdown and thread link + live count
   ("ep 9 thread · 14 in there"). Composable client-side from the existing
   `/schedule` + list data. Empty state: seasonal picks.
2. **Live now** — busiest threads (M2 velocity + presence), latest comment
   snippet ticking in.
3. **Continue watching** — next unwatched episode per show, inline `+1`,
   "discuss ep N" link.
4. **The season's conversation** — existing trending, reframed with
   discussion stats ("312 comments this week").
5. Existing schedule strip + hidden-gems teaser, compact.

The current all-purpose home (seasonal grid first) becomes the logged-out
fallback content — the *chart* stops being the signed-in front door.

### Logged-out landing

SSR, revalidate ~60 s, SEO-complete. Sections:

- Hero: **"Watch the season together."** Sub: live episode threads,
  spoiler-safe by your progress, import from MAL/AniList in minutes.
  CTA: Join + a "peek at tonight's threads" link (threads are publicly
  readable — the product is its own demo).
- **Live proof**: ticker of recent public comments / busiest threads
  (server-fetched, cheap cache; SSE upgrade optional). A landing page that
  visibly moves is the pitch.
- Tonight's schedule strip · this week's busiest threads · seasonal chart
  preview · the no-streams promise + AniList attribution.

### Onboarding (post-register)

One skippable step: pick the currently-airing shows you're watching (grid,
3+ taps) → seeds the list so home isn't empty — plus the **import CTA**
(M1). Nav gains a **Threads** hub (`/threads`: tonight's threads, busiest
this week) so discussions are a destination, not a detour.

---

## M4 — watch parties

Design unchanged, in [WATCH_PARTIES.md](WATCH_PARTIES.md): WebSocket rooms,
shared playback clock, live reactions that persist (opt-in) into the
canonical episode thread. Flag-gated `FEATURE_WATCH_PARTIES`. Builds on
M2's `internal/realtime` + pub/sub plumbing. Entry points: "start a party"
on episode pages; public parties discoverable on the schedule page and
"Tonight on Cour".

---

## Deliberately deferred

| Idea | Why not now |
|---|---|
| **Browser extension** (overlay synced comments on streaming sites) | A second codebase with per-site DOM breakage, MV3 store review, and its own release train — while timeline comments + watch parties deliver ~80 % of the job in-site. The seams it needs (timestamped comments API, party clock protocol) exist/arrive anyway; an extension is "just another client" when demand proves out. Revisit post-M4. |
| MAL OAuth live-sync; AniList OAuth (private lists) | XML export + public API cover the funnel without key management. |
| Per-comment episode-scope tags on series boards | Complexity > return while episode threads carry live traffic. |
| Tag-based seasonal filtering | Genres cover most value; ranked-tag UX is its own design problem. |
| Polls, weekly digest email, season wrap-up share cards, PWA/push | Good retention/marketing loops, all parasitic on M2/M3 existing first. Wrap-up cards are the strongest candidate (shareable = acquisition). |

## Cross-cutting rules

- **Spec-first stays law**: every new endpoint enters
  `backend/api/openapi.yaml` first; `task gen` propagates both directions;
  CI drift check unchanged.
- Imports and any future bulk writes obey the **zero-activity rule**.
- All new UI is **mobile-first** (M0's bar is the floor) and respects
  `prefers-reduced-motion`.
- The **no-streams promise** appears verbatim on the landing page.
- Tests ride along: unit tests on matching/score-conversion/velocity math,
  integration tests for the import flow and SSE handshake, vitest for the
  event-merge hook.

## Risks

| Risk | Mitigation |
|---|---|
| SSE buffered by the Next rewrite | Milestone-opening spike; fallback = direct route or polling behind the client wrapper. |
| Import poisons Trending / floods feeds | Zero-activity rule + regression test (M1). |
| `idMal` null for some titles | Trigram title fallback + manual review bucket. |
| Backfill re-crawl duration (22 k titles, rate-limited) | Start early in M1; delta sync maintains it after. |
| Cookie-presence heuristic wrong | Authed shell degrades gracefully to anon client-side. |
| Presence accuracy multi-instance | Single-instance now; interface leaves the Redis sum as a swap-in. |
