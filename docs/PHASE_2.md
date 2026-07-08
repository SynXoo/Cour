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

- [x] **M0.1** (O) Flash fix — delayed `Skeleton` (~150 ms fade-in) +
  `keepPreviousData` on `/list` tabs (both verified in preview).
  SSR-prefetch deferred — fights the rotating-refresh auth model (§M0,
  Parking lot).
- [x] **M0.2** (O) Layout widths — per-surface `PageShell` (browse ~88 rem /
  reading `max-w-3xl` / forms narrow), `AnimeGrid` auto-fill columns,
  header tracks the widest shell (verified 375/1440 in preview).
- [x] **M0.3** (F) Mobile foundation — bottom tab bar (Home · Seasonal ·
  Search · My list · Menu), header collapse on mobile, safe-area insets,
  toaster to top-center on mobile.
- [x] **M0.4** (O) 375 px audit — episode-thread header restructured (nav
  drops to its own row < `md`; title/date stop wrapping) + 44 px touch
  targets across the whole thread surface below `md`; app-wide button/input
  mobile sizing deferred (Parking lot). Verified 375/768/1440/2560.
- [x] **M0.5** (O) Seasonal controls — client-side sort
  (popularity/score/title/weekday/newest) + genre/format/weekday filter
  chips, URL-synced; flatten format groups on any non-default view;
  schedule page "my shows" toggle. (Verified 375/desktop, anon+authed.)

### M1 — import

- [x] **M1.1** (O) `mal_id` — nullable-unique migration, `idMal` through the
  AniList query/mapper/fixtures; the migration resets the backfill cursor so
  the next non-demo worker boot re-crawls the catalog to populate it.
- [x] **M1.2** (F) Import backend — openapi endpoints, `import_jobs` table,
  asynq pipeline, matching (ids → trigram fallback → review bucket),
  score/status conversion, **zero-activity bulk apply + the
  trending-unchanged regression test**.
- [x] **M1.3** (O) Import UI — `/settings/import` (start / progress /
  preview-review / done screens), AniList username + MAL upload, 2 s
  polling, merge | overwrite with conflict callout, review resolution via
  catalog-search picker, per-row exclude/re-match; job id persisted in
  localStorage so reloads resume. E2E-verified against the live stack at
  375/desktop (zero-activity rule held: 663 activities before and after).

### M2 — live thread layer

- [x] **M2.1** (F) SSE gateway — rewrite-streaming spike confirmed (dev +
  standalone both stream unbuffered); `internal/realtime` hub + Redis pub/sub;
  `GET /threads/{id}/events` (comment/reaction/presence events); publish
  post-commit from the discussion **handlers** (reuse the REST DTO mappers so
  `comment.created` is byte-identical to the cached `Comment`); unit +
  integration tests.
- [x] **M2.2** (F) Live client — `useThreadEvents` merging into the React
  Query cache, slide-in comments, "N new comments" pill when scrolled,
  presence badge (shows at ≥ 2), polling degrade on error,
  `prefers-reduced-motion`. (E2E-verified live on the Docker stack at
  375/desktop: the four events all fold in without a refresh.)
- [x] **M2.3** (O) Velocity + spoiler guard — `comments(created_at)` index,
  `GET /threads/trending` (decay + presence bonus, 60 s cache; no UI
  consumer yet — M3 wires it), progress-aware banner/blur on episode
  threads (**must cover the reply quote chips** — see the spoiler-guard
  section), inline "mark ep N watched". Stretch: night-of badge, bell 60 s
  refetch. (E2E-verified 375/desktop on the live stack.)

### M2.4–M2.6 — inserts from the 2026-07-07 review

Miguel + Fable walked the live site; diagnosis and specs in
[the M2.4–M2.6 section](#m24m26--ui-identity--scale-inserts) below.

- [ ] **M2.4** (O) Typography split — JetBrains Mono stops being the body
  font: prose and prose headings move to a real sans; mono stays for data
  (timestamps, countdowns, ep/stat counts, scores). One `globals.css` +
  font-loading change, then an app-wide re-verify at 375/desktop.
- [ ] **M2.5** (O) Episode list pagination — newest-first default with
  asc/desc toggle, range pages of 50 (newest range active), "Latest
  episode" jump in the detail action bar next to Discussion. One Piece
  scale (1000+ eps) is the acceptance test.
- [ ] **M2.6** (O) Thread comment pagination — replace the silent
  `LIMIT 500` truncation with cursor pages + "load older"; live merge and
  the four sorts keep working over the loaded set (see spec for the Top/
  Timeline caveat).

### M3 — home & landing

- [ ] **M3.1** (F) Landing + routing — `cour_refresh` cookie branch in
  `app/page.tsx`, hero, live-proof ticker, tonight strip, seasonal
  preview, no-streams promise, SEO metadata.
- [ ] **M3.2** (O) "Tonight on Cour" — your-evening row, live-now threads,
  continue-watching, the season's conversation, compact existing strips,
  **"Back in the conversation" row** (trending titles not from the current
  season — the viral-revival story told explicitly; see §M3).
- [ ] **M3.3** (O) Onboarding + threads hub — post-register pick-your-shows
  + import CTA, `/threads` page (tonight / busiest this week), nav
  updates on desktop + bottom bar.
- [ ] **M3.4** (F) Thread texture — timestamp-density strip (mini episode
  timeline; clusters jump the list via `jumpToComment`), richer empty
  state (countdown/presence instead of "No comments yet"), live-window
  LIVE badge + velocity in the thread header. Spec in §M3.

### M4 — watch parties ([design](WATCH_PARTIES.md))

- [ ] **M4.1** (F) WS gateway + presence, flag-gated
- [ ] **M4.2** (F) Shared clock — host controls, drift correction
- [ ] **M4.3** (O) Live chat + reactions + opt-in persistence into threads
- [ ] **M4.4** (O) Room lifecycle + discovery (episode page, schedule, home)

### Session log

<!-- One line per completed session: date · task · outcome / notes for the next session. -->

- 2026-07-08 · M2.3 · Velocity + spoiler guard. **Backend:** migration
  `000015` adds `comments(created_at)`; new `GET /threads/trending` (spec'd,
  codegen'd, `?limit` 1–20 default 10) served by
  `internal/discussions/trending.go` — score = Σ 2^(−age/6 h) over live
  (non-deleted) comments in a 48 h window + 2.0·presence; top-20 ranking
  cached 60 s in Redis (`threads:trending:v1`, **stats only** — thread/anime
  hydration and the presence numbers *shown* are read live per request, so
  only the ranking is ever stale). Presence-only rooms rank too, via new
  `Hub.Presences()` — lurkers gathering pre-episode make a thread hot before
  anyone posts. Formula + constants documented in ALGORITHMS.md §1b
  (deliberately not env-tunable yet). **No UI consumer this session — M3.1/
  M3.2/M3.3 wire it.** 7 scorer unit cases + integration
  `TestTrendingThreads` (fresh-beats-older, lurker-only thread ranks via a
  real SSE connection, episode context hydrated). **Web:** new
  `EpisodeSpoilerShield` wraps ThreadView on episode pages: when the viewer
  is behind on an aired episode-N thread → amber banner ("You're K episodes
  behind (on episode P)" / "You haven't watched this episode yet" when
  next) + blur-all through new `SpoilerShieldContext` — comment bodies ride
  the existing per-comment `SpoilerGuard` (its reveal button = the
  per-comment override), reply quote chips show *hidden comment*, and the
  **composer's reply-to chip** is covered too (same leak). "Show anyway" is
  a toggle (aria-pressed). Decisions (spec updated in place): known-upcoming
  episodes skip the guard (speculation banner owns those) but **null
  `airing_at` still guards** — demo Frieren has no per-episode dates and a
  finished show's thread is exactly where the spoilers are; completed
  entries never guard; while the entry query is in flight authed viewers get
  a brief blur (blur→reveal beats a spoiler flash). **Mark ep N watched**
  rides the banner when N == progress+1, sends `{status:"watching",
  progress:N}` (server QoL: final ep flips completed, stamps started_on),
  banner+blur clear from the upsert's cache write — E2E-verified live
  (progress 8→9, then restored). **Night-of badge** (stretch): new
  `EpisodeAiringContext` + a mono "night of" pill on comments posted within
  24 h after airing; bell 60 s refetch was already in from an earlier
  session. Gotchas: `react-hooks/purity` bars `Date.now()` in render — the
  page computes `aired` server-side and passes it as a prop; the banner text
  needed `basis-full md:basis-0` at 375 or the button cluster starves it to
  one word per line. Tests: **83** vitest (12 files; +6 shield cases incl.
  quote-chip cover, reveal toggle, mark-watched payload, night-of) + go
  unit + **full integration suite**, `task lint` + `task gen` clean.
  Verified in preview at 375/desktop as sakuga_sam (Frieren ep 9/10; badge
  on a same-day premiere). Ops: compose **api** image rebuilt (migration 15
  + endpoint live, smoke-tested against the demo DB — Frieren series thread
  ranks #1 off the M2.2 test comments); left 3 comments on Frieren ep-10 and
  1 on Sora wa Akai Kawa ep-1 in the demo DB (re-seedable via `task seed`).
  **Next (M2.4):** typography split — body/prose to a real sans, mono stays
  for data (timestamps, countdowns, counts, scores); one `globals.css` +
  font-loading change, app-wide re-verify 375/desktop.
- 2026-07-07 · plan (UI review, no code) · Walked the live site with Miguel.
  Verdicts: the "popular beyond the season" ask is **already served** by
  Trending Now (all-catalog 14-day window + AniList blend — AoT/MHA rank
  today; an all-time popular tab was explicitly rejected as anti-thesis);
  the "generic feel" is diagnosed as **mono-as-body-font + uniform visual
  weight**, not the palette. Added ledger tasks M2.4 (typography split),
  M2.5 (episode list pagination + latest-first + jump-to-latest, Miguel's
  ask), M2.6 (thread comment pagination past the LIMIT 500 truncation),
  M3.4 (thread texture: density strip / empty state / live header), the
  "Back in the conversation" row on M3.2, and a Parking-lot entry deferring
  any palette rebrand until after M3. Order stands: **M2.3 is still next.** (out-of-band, from live user feedback on M2.2's surface) ·
  **The bug:** a reply rendered under *every* top-level comment. ThreadView passes
  the full descendants list to `groupReplies` once per root, and its "orphan
  adoption" fallback glued any comment it couldn't trace to the current root onto
  it. Orphans are impossible (comments arrive `ORDER BY id LIMIT 500` in one shot;
  a parent's id < its replies') so `groupReplies` now **skips** non-subtree
  comments — each root extracts exactly its own subtree from the shared list. DB
  was always right; render-only. Regression: `comment-item.test.tsx` (unit table:
  nesting, sibling isolation, interleaved subtrees) + a ThreadView
  render-once-under-parent test. **UX (greenlit "whatever you think is best" +
  newest-on-top + popularity sort):** default sort is now **Newest**; control is
  Newest / Oldest / Top / Timeline (Top = root's reaction total, ties → subtree
  reply count → newest; replies always chronological under their parent;
  client-side over the single fetch). Live layer is **sort-aware**: the catch-up
  sentinel sits at the arrival edge (top for Newest, bottom for Oldest), the pill
  points there (↑/↓), and clicking it — or posting — runs `jumpToComment(id)`
  (double-rAF, `scrollIntoView` + `comment-flash` pulse; no-ops when the id isn't
  rendered, e.g. untimestamped arrivals in Timeline); Top/Timeline never
  auto-follow others' posts. **Reply flow:** Reply scrolls the composer into view
  + autofocuses (animated `reply-chip`, Ctrl/Cmd+Enter posts); every reply renders
  a tappable **quote chip** of its parent via new `CommentsIndexContext`
  (spoiler-marked/deleted parents quote as italic placeholders — **M2.3's
  blur-all must cover these chips**, spec updated). **Identity:** own comments =
  tinted `bg-primary/10` bubble + "you" badge; `.avatar-hue` derives a stable
  per-username oklch tint (JS sets `--avatar-hue`; light+dark variants;
  unlayered CSS deliberately beats utility-layer `bg-muted`). **Tapbacks:**
  emoji burst + spring pop on react (burst key from a `useRef` counter —
  `react-hooks/purity` rejects `Date.now()` in handlers), staggered picker
  entrance via `--i` delay; all new motion has reduced-motion fallbacks.
  Gotcha for future tests: the quote chip duplicates parent body text in the
  DOM — anchor body queries on the `<p>`. `onCreated` now depends on
  `[user, sort]` (fine: `useThreadEvents` holds the callback in a ref, stream
  never re-opens). Typing indicator deliberately deferred → Parking lot. Tests
  **77** vitest (11 files) + lint + tsc green; verified live on the Docker stack
  at 375/desktop (sort orders, composer focus flow, flash-jump, burst, Top
  ordering, no h-overflow, 44 px targets). Demo DB: thread 8 (anime 16 ep 1)
  gained a small real reply tree — Miguel live-tested mid-session and his
  replies nested correctly. Two commits: `fix:` then `threads:`.
- 2026-07-07 · M2.2 · Live client — consumes the M2.1 SSE gateway; no backend
  changes. New `lib/hooks/use-thread-events.ts`: `useThreadEvents(threadId,
  {onCreated, enabled})` opens `EventSource('/api/v1/threads/{id}/events')` (rides
  the spike-proven `/api/*` rewrite, **no token** — the endpoint is optionalAuth
  public read, and EventSource can't set Authorization anyway; anon viewers get
  presence + live comments too). The four events are **named**, so the default
  `message` handler never fires — `addEventListener` per name. Each folds into the
  `["comments", threadId]` cache via three **pure, exported** helpers (unit-tested
  in isolation): `applyCreated` (append, or replace-by-id → idempotent so the
  poster's own echo and a reconnect replay never double a row), `applyDeleted`
  (tombstone in place to the REST shape — `deleted:true` + `"[removed]"`; returns
  the **same reference** when the id is absent so React skips a re-render),
  `applyReaction` (update count **preserving the local `mine`** — the event carries
  no ownership; add a brand-new emoji as `mine:false`; drop it at count 0; re-sort
  to the canonical +1/heart/laugh/surprise/cry/fire order so a live-added chip
  lands where the next REST fetch would put it). `presence` → state; **degrade**:
  `error` → `degraded:true` (EventSource self-reconnects), `open` → clear **and**
  one `invalidateQueries` to reconcile events missed while down — but only after a
  prior error (a `missedWhileDown` flag), so first connect doesn't double-fetch.
  `onCreated` is held in a ref refreshed each render, so its identity never
  re-opens the stream. **ThreadView wiring:** `refetchInterval: degraded ? 15_000
  : false` — a dropped stream degrades to polling until it's back; presence badge
  "N here now" (ping dot with `motion-reduce:animate-none`) shows at ≥ 2; **"N new
  comments" pill** — a bottom sentinel + `IntersectionObserver` tracks
  at-bottom (a ref), a live arrival while scrolled up bumps `newCount` → a `fixed`
  pill clearing the mobile bottom-nav (`bottom-[calc(5rem+env(safe-area-inset-bottom))]
  md:bottom-8`); at the bottom (or the viewer's **own** post, matched by username)
  it auto-scrolls via rAF `scrollIntoView` (behavior honours reduced-motion)
  instead of yanking. **Slide-in:** live-arrived ids ride a `LiveCommentsContext`
  (avoids drilling through the recursive `CommentItem`); the item adds
  `comment-enter` when its id is in the set; new `@keyframes comment-slide-in`
  (opacity + `translateY(8px)`, 220 ms) is disabled under
  `prefers-reduced-motion`. Kept the existing post/delete/react `invalidate`
  calls — the acting user still gets instant feedback if SSE is degraded, and the
  idempotent merges dedupe the SSE echo. **Verified E2E on the live Docker stack**
  (rebuilt api+worker+web — the compose images predated M2.1/M1.3 per that
  heads-up): thread 200 (Frieren series) as sakuga_sam — `GET /threads/200/events`
  streamed `presence{1}` on connect; a second `EventSource` lifted the badge to
  "2 here now"; posting as cour_counter/eyecatch_emi via the API surfaced
  `comment.created` **live** (slide-in class + `animation-name` confirmed) with
  auto-scroll at the bottom and no yank; `reaction.updated` ticked comment 29 to
  ❤️1 🔥1 (new emoji inserted in canonical order, existing preserved);
  `comment.deleted` tombstoned to `[removed]` live. 375 + desktop, dark. **Pill
  caveat:** its scrolled-up branch can't be exercised in the preview harness — the
  harness's `IntersectionObserver` reports the bottom sentinel as *always visible*
  (whole document = viewport), so `atBottom` stays true and arrivals auto-scroll;
  covered instead by a component test with a controllable observer. **Tests:** +16
  vitest — `use-thread-events.test.ts` (10 pure-helper cases + 3 `renderHook`:
  presence/degraded/reconnect-invalidate transitions, cache-merge + `onCreated`,
  close-on-unmount) and `thread-view.test.tsx` (6: stream opens for the thread,
  badge ≥ 2 only, live append + pill, slide-in class, live delete tombstone,
  close-on-unmount) — fake `EventSource` + fake `IntersectionObserver`. Web **70**
  vitest across 10 files; `task test` + `task lint` green (golangci 0, eslint,
  tsc). Go untouched. **Infra fix (needed to keep the suite green):** a pnpm
  hardlink mirror (`.pnpm-store/v11/projects/<hash>`, git-ignored, reached through
  `node_modules` symlinks) got populated with the new test files mid-session, so
  `include: **` discovered every test **twice** — the mirror copy runs outside
  jsdom and died on `document`. Scoped `include` to `{app,components,lib}/**` and
  hardened `exclude` to `**/{node_modules,.next,.pnpm-store}/**`; `vitest list`
  stays 10 files, `run` stable at 70/70. Ops: the compose **web** image now carries
  M1.3 + M2.2 (rebuilt); left ~10 throwaway test comments on the Frieren series
  thread in the local demo DB (re-seedable via `task seed`). **Next (M2.3):**
  velocity + spoiler guard — `comments(created_at)` index, `GET /threads/trending`
  (decay + presence bonus, 60 s cache), progress-aware banner/blur on episode
  threads, inline "mark ep N watched".
- 2026-07-07 · M2.1 · SSE gateway — the live thread layer's transport, backend
  only (no UI; the live client is M2.2). **Spike first, as the plan demands:** a
  throwaway Go SSE server behind the real Next `/api/*` rewrite + a
  chunk-timestamping fetch client proved `text/event-stream` streams
  **unbuffered in both `next dev` (Turbopack) and the standalone prod build**
  (events arrived 1 s apart, not batched at close; `content-encoding: null` so
  no gzip buffering). The rewrite is safe — **no fallback needed** (the risk
  table's direct-route / 15 s-polling degrade stays unused). **Spec:** new `GET
  /threads/{threadId}/events` (`text/event-stream`, `schema: {type: string}`,
  rich description of the four named events) + component schemas
  `CommentDeleted` / `ReactionUpdate` / `PresenceUpdate`. It's **excluded from
  oapi-codegen** via `exclude-operation-ids: [streamThreadEvents]` (v2.7.1
  supports it) so I can hand-route it; the three schemas prune out of Go
  (`skip-prune:false`) but **openapi-typescript still emits the path + types**
  for the M2.2 client (verified: absent from `api.gen.go`, present in
  `schema.d.ts`). `comment.created` reuses `apigen.Comment` — zero drift.
  **Routing:** the 30 s `middleware.Timeout` moved from a root middleware to a
  per-group wrapper around the apigen routes only, and the events route is
  hand-registered on the `/api/v1` group (optionalAuth + global rate limit)
  **outside** that group — a timed-out request context would otherwise tear the
  stream down every 30 s (and churn presence). Health checks are now untimed
  (trivial pings; accepted). **`internal/realtime.Hub`:** one `PSUBSCRIBE
  thread:*` per instance routes every published event to local per-thread
  subscriber sets. Chose the pattern-subscribe over dynamic per-thread SUBSCRIBE
  deliberately — simpler, lock-friendly, and **no Redis I/O on the hot Subscribe
  path**; this instance sees all threads' events, which is cheaper than churning
  subscriptions as readers come/go at Cour's scale, and the Publish/channel
  contract is unchanged so a multi-instance build swaps the impl without
  touching callers. Presence = the **local in-memory connection count**
  (per-instance; summing across instances via Redis is the documented swap-in).
  Events: `comment.created` (full Comment), `comment.deleted {comment_id}`,
  `reaction.updated {comment_id, emoji, count}`, `presence {count}` (on connect
  + every change). Slow reader = non-blocking send, **drop past a 32 buffer**
  (the client's refetch degrade path reconciles) so one stalled consumer can't
  block fan-out; `dispatchLocked` holds the mutex so a send can't race a
  subscriber's removal-and-close in `cleanup` (guarded by `sync.Once`). Publish
  is **best-effort** (Redis error logged, never fails the user action —
  post-commit anyway, and SSE tolerates a lost event). **Publish from the
  handlers, not the service:** the handlers own `toComment`, so the event is the
  exact REST shape; `Service.Delete` now returns `threadID` and `Service.React`
  returns `(threadID, count)` via a new `ReactionCountFor` query — only the two
  handlers called them, no other callers. **SSE handler:** `text/event-stream` +
  `no-cache, no-transform` + `X-Accel-Buffering: no`, 404 when the thread is
  missing, 25 s `: ping` keep-alive, `select` on ctx-done / event / ping, frames
  `event: <name>\ndata: <json>\n\n` (json.Marshal is single-line so one data
  line is always valid). **Tests:** 7 realtime unit cases (presence math,
  fan-out, drop-on-full, idempotent cleanup, dispatch-to-unknown-thread noop,
  channel round-trip) — white-box, no Redis needed; 1 integration
  (`TestThreadSSELiveEvents`) over a **real SSE connection + real Redis
  pub/sub**: presence 1 → REST post surfaces as `comment.created` (body matched)
  → `reaction.updated` 1 then 0 → a second reader lifts presence to 2 then back
  to 1 on leave → `comment.deleted`. **Race the test closes:** it waits for
  `presence{1}` (proof the subscription is live) before posting, so the first
  broadcast can't beat registration; `bodyclose` nolint on the stream open (the
  read goroutine owns the body). All green: go unit + **full integration suite**
  (existing thread/notification flow undisturbed by the added Publish calls),
  golangci **0 issues** (incl. `--build-tags=integration`), web **51** vitest +
  tsc + eslint, `task gen` clean. **Ops:** the running compose **api + worker
  images predate M2.1** — `docker compose up -d --build api worker` before any
  live SSE demo; no web changes this session. **Next (M2.2):** the live client —
  `useThreadEvents(threadId)` wrapping `EventSource`, merging the four events
  into the React Query cache (`comment.created` is the `Comment` shape → plain
  append; `presence` badge shows at ≥ 2; degrade to interval refetch on error;
  `prefers-reduced-motion`). Endpoint rides the `/api/*` rewrite (spike-proven),
  no token in the URL.
- 2026-07-07 · M1.3 · Import UI end to end, consuming exactly the four M1.2 endpoints. New route `/settings/import` (`PageShell width="reading"` — the preview rows need more than the form column; Settings keeps a link section) with a status-routed flow: start (AniList username + MAL file cards) → progress (poll 2 s via `refetchInterval` keyed off `pending/processing/committing`) → preview/review (`ready`) → done | failed | superseded. **State model:** the job id lives in localStorage behind `useSyncExternalStore` (`lib/hooks/use-import.ts`) — job ids only ever appear in the creation response, so this is what makes reload-resume work; writes `emit()` to re-render this tab, the native `storage` event syncs other tabs, and a 404 in the job queryFn clears the slot (stale id after a DB reset). Chose the store pattern because the new `react-hooks/set-state-in-effect` lint rule (correctly) rejects the naive restore-in-effect. **Multipart:** openapi-fetch takes `bodySerializer: () => FormData` and skips its JSON Content-Type when the serialized body is FormData (verified in its source) — the typed `body: { file: "" }` is a placeholder. **Preview screen:** counts strip; conflict callout + merge/overwrite `aria-pressed` toggle; `summarizeCommit` prediction line (matched the server exactly in E2E: 6 imported / 4 skipped); review bucket rows get Find match / Change / Clear via a cmdk `Command` dialog (`shouldFilter={false}`, seeded with the source title, debounced `/anime?q=` — `useDebounced` extracted to `lib/hooks/`, search-client now imports it); matched rows get exclude/restore everywhere and re-match on title-matched rows (backend `apply` honours resolutions on *any* row, `apply.go:19`); rows render in chunks of 100 with Show more (10k cap ⇒ never mount 10k `<li>`); thumbs are plain `<img loading="lazy">`, not next/image (32 px thumbnails gain nothing and it keeps vitest simple). **375 px lesson:** badges in the right-hand action cluster starve the `min-w-0` title ("Here U Are" truncated to one character) — badges now ride the meta line inside the text column; only icon actions stay right. E2E on the live stack (crafted 10-row XML against fixture mal_ids): 8 matched (7 id + 1 title)/2 review/2 conflicts; picker-resolved a review row → DAN DA DAN landed completed ★6; excluded row stayed out; merge kept Frieren untouched; **activities 663 → 663** (zero-activity rule through the real UI); `/list` refreshed via `invalidateQueries(["list"])` without reload; reload resumed to done; discard→new-import superseded the ready job (job 2 → superseded, by design). Failed path verified live with a twist: **the worker rebuild re-enqueued the M1.1 backfill re-crawl (migration cleared the cursor), and the crawl saturates the AniList rate budget — the import's UserList fetch 429-starved through all asynq retries and the final-retry backstop marked the job failed** with a friendly error (Parking lot: rate-budget priority for interactive fetches). Ops note: the compose **worker image predated M1.2** (no import task handler — imports would have sat in `processing` forever); rebuilt. The compose **web image still predates M1.3** — `docker compose up -d --build web` before demoing prod. Tests: +19 vitest (helpers table incl. summarize edge cases; preview flow with mocked picker — bucket split, mode/summary reactivity, exclude/restore, resolution payload, two-step discard; start-screen gating incl. oversized-file reject) = 51 total; tsc/eslint/`task test` green. Go untouched. **Next (M2.1):** SSE spike first (Next rewrite streaming, dev + standalone); the import UI needed no SSE — polling was plenty at 2 s. Import backend end to end. **Spec**: 4 endpoints (`POST /import/anilist`, `POST /import/mal` multipart field `file`, `GET /import/jobs/{id}`, `POST /import/jobs/{id}/commit`); heads-up: adding the Import\* enums reshuffled oapi-codegen's collision naming so the `apigen.ListStatus*` constants lost their prefix (bare `apigen.Watching` now; deterministic — hash-verified over repeated runs; lists.go updated). **Migration `000014_import_jobs`**: `import_source`/`import_status` enums, `import_jobs` (payload/rows/counts jsonb + error), and the race-free "one live import per user" rule as partial unique index `import_jobs_one_active_idx (user_id) WHERE status IN (pending,processing,committing)` — `ready` deliberately excluded so an abandoned preview never blocks; creating a new import *supersedes* ready ones in the same tx as the insert (unique violation → 409). Lifecycle: pending→processing→ready→committing→done|failed|superseded; a failed apply rolls back and **reopens to ready** (error recorded, commit retryable). **`internal/imports`**: convert.go (MAL text+legacy-numeric statuses; AniList `REPEATING`→completed; scores per spec table, nonzero never rounds away to unscored — clamps [1,10]), mal.go (gzip sniffed by magic bytes, 64 MiB decompression cap, CDATA + `0000-00-00`, junk rows dropped not fatal, parse happens at upload so bad files 422 immediately), match.go, apply.go. **Matching gate** (`pickMatch`, unit-tested as a table): candidates disagreeing with source-declared format-group/year(±1) are disqualified; the survivor needs sim ≥ 0.95 alone or ≥ 0.88 with one actively agreeing attribute; and must beat the runner-up by ≥ 0.05 (photo-finish → review). Format groups fold OVA/ONA/Special together (cross-DB labeling chaos); MAL exports carry no year so unknown attrs neither help nor hurt. **sqlc gotcha**: `@query % title_romaji` breaks sqlc's named-param rewriter ("syntax error at or near ji") — trigram `%` is commutative, write `title_romaji % @query`; and `MatchAnimeByTitle` uses whole-title `similarity()`, *not* `word_similarity` (which scores "Death Note" a perfect 1.0 against "Death Note: Rewrite"). **Zero-activity apply**: dedicated `ImportUpsertListEntry` (ON CONFLICT DO UPDATE; status/score/progress import-wins incl. clearing score, dates COALESCE so imports fill but never blank) looped in one tx with no `InsertActivity` anywhere; merge skips rows on the *live* list read in-tx (preview `on_list` is stale by definition); completed rows normalize progress to `episodes_count`; **no QoL transitions** — historical dates are never invented. Commit is synchronous (single tx ≪ 1 s at the 10k cap); `resolutions` {row_index → anime_id | null=exclude} validated before the job is claimed. **AniList fetch**: new `anilist.Client.UserList` (one MediaListCollection request, custom lists skipped, deduped, raw score + user scoreFormat — conversion stays ours, per spec) + typed `*anilist.GraphQLError` so semantic failures (unknown user/private list) fail the job without asynq retries while transport errors retry ×5, and the **final retry marks the job failed** (a task dying in 'processing' would otherwise block that user's imports forever via the partial index). API-side `imports.Enqueuer` is *not* best-effort: enqueue failure fails the job row and 500s. Demo mode: `/import/anilist` 503s at the API (worker has a backstop); **MAL import works offline in demo** — fixtures carry real mal_ids since M1.1, nice for M1.3 UI work. Caps: 10k rows, 20 MiB upload. Tests: ~44 unit cases (all score formats, MAL parse plain/gz/garbage, gate table, `entryParams` normalization, task payload) + 3 integration: **TestMALImportZeroActivity is the spec's regression test** — 500-entry multipart import → trending ranking identical across recomputes (safe from flake: uniform exponential decay preserves order), follower feed identical, zero new activities, merge preserved the pre-tracked entry (applied=499/skipped=1); TestAniListImportFlow (GraphQL stub via `WithURL`: 409 while active, supersede, REPEATING→completed with progress→count and source `finished_on` kept, overwrite clears score when source unscored, review resolution, double-commit 409, cross-user 404); TestAniListImportDemoMode. Harness change: `register()` resets the 5/min per-IP register limiter first (the suite now registers ~10 users from 127.0.0.1; rate limiting isn't under test there). All green: go unit+integration, golangci 0 issues, web 32 vitest + tsc + eslint (schema.d.ts regenerated & committed). **Next (M1.3)**: consume exactly these endpoints — poll GET ~2 s while pending/processing, preview rows arrive hydrated with `AnimeSummary`, resolutions ride the commit body, multipart field name is `file`; consider surfacing `counts.conflicts` prominently before the mode choice.
- 2026-07-06 · M1.1 · `mal_id` prerequisite for the MAL import path. Migration `000013_anime_mal_id` adds `anime.mal_id INTEGER UNIQUE` (nullable — not every title has a MAL entry). `idMal` threaded through the whole sync pipeline: new `Media.IDMal *int` (types.go), `idMal` added to the shared `mediaFields` GraphQL fragment (so **every** sync path — season/trending/catalog/updated/airing/snapshot — carries it), `MapMedia` maps it to `UpsertAnimeParams.MalID` via `toInt32`, and `UpsertAnime` writes/updates `mal_id` (col `$25`, added to the `ON CONFLICT DO UPDATE SET` so re-crawls populate existing rows). `task gen`/sqlc regenerated — `MalID *int32` on the `Anime` model propagates `anime.mal_id` into every embedded SELECT (discovery/lists/reviews/social/etc.); no openapi change, so oapi/openapi-typescript untouched (M1.1 is backend-only, no UI, no `mal_id` in the API yet — that arrives with M1.3). **Backfill re-crawl kickoff = the migration itself**: existing rows predate the column so their `mal_id` is NULL, and the already-completed backfill's `Done` cursor would no-op a re-enqueue — so the up migration does `DELETE FROM sync_state WHERE key='anilist_backfill'`, and since `Bootstrap` already enqueues `TypeBackfillCatalog` unconditionally (non-demo), the next real worker boot re-crawls the full 22k catalog over hours under the rate budget; the 6-hourly delta keeps it fresh. No new CLI/task needed. Demo mode gates the crawl off (fixtures are the source there). **Fixtures gain idMal**: enriched `fixtures/anime.json` in place via a throwaway one-shot tool (queried AniList `id_in` for the 295 fixture ids, merged idMal only — 281 matched, 14 genuinely null; diff is +295 idMal lines, 0 removed) so the demo world seeds real MAL ids; the tool was deleted after. Tests: new mapper assertions (idMal→MalID, absent idMal→NULL); `go test ./...` + golangci-lint green. Verified against the live docker stack: migrated the DB to v13 through the real migrator (`mal_id` nullable, unique index `anime_mal_id_key`, backfill cursor row gone), re-seeded, confirmed correct MAL ids (Shingeki 16498→16498, Kimetsu 101922→38000, JJK 113415→40748, Death Note 1535→1535); 281/22416 rows populated from fixtures, the rest await the re-crawl. Web suite untouched (no web changes). **Next (M1.2):** the import backend can now match on `mal_id`; remember the zero-activity bulk-apply rule + the trending-unchanged regression test.
- 2026-07-06 · plan · Roadmap + ledger written; watch-party design moved to WATCH_PARTIES.md; sqlc drift committed. Nothing implemented yet.
- 2026-07-06 · M0.5 · Seasonal sort+filter + schedule "my shows" toggle. New `lib/seasonal.ts` (pure, unit-tested — 20 new vitest cases): sort (popularity default · score nulls-last · title locale-compare · airing-weekday nulls-last · **newest = `id` desc**, a documented proxy since `AnimeSummary` carries no premiere date) + AND-combining filters (format group / genre / weekday) + `isGroupedView`/`collectGenres`/`collectWeekdays`. New client `seasonal-view.tsx` reads `?sort/format/genre/day` via `useSearchParams` (defaults dropped from the URL so shared links stay clean), renders a Sort `Select` + toggle `Chip`s (`Button` `aria-pressed`, single-select, click-active-to-clear) + Clear; **default view keeps the TV/Movies/Specials grouping, any non-default sort or active filter flattens to one `AnimeGrid`**. Page keeps the SSR header/season-nav and wraps the view in `<Suspense>` (useSearchParams prerender bail-out). Schedule: pulled the day-grouped list into shared `components/anime/schedule-days.tsx`; new client `schedule-view.tsx` renders the SSR list as pass-through **`children`** (no re-exec → no TZ/hydration mismatch; default times stay server-rendered) and, once the authed viewer flips the `Switch`, swaps to a client `useMyList` join — verified in preview against the API (118 schedule eps → the viewer's 4 list shows, titles matched exactly). Fixed a **pre-existing** mobile overflow in the schedule cards: the `<li>` grid item needed `min-w-0` so long titles truncate instead of forcing the card wider than its column (was 972 px scrollWidth at 375). Verified in preview at 375/desktop, anon + authed, and the shareable-URL/SSR path (`?sort=score` loads flattened & score-desc; `?sort=title&format=movies` combines); 0 console errors; web typecheck/lint/**32** vitest green (Go untouched, `task lint`'s golangci step needs the PATH quirk). **Accepted limitation:** weekday sort/filter derive from `next_airing_at`'s *local* weekday, so a shared `?day=` link SSR'd under a server TZ ≠ the viewer's can briefly disagree on a midnight-crossing title (self-healing on hydration, weekday-filtered links only). Chips use the compact `sm` scale (28 px) — the app-wide 44 px touch-target lift stays the deferred primitive-level task (Parking lot); since they're `Button`s they inherit it for free.
- 2026-07-06 · M0.4 · 375 px thread-surface audit. **Episode-thread header** (`episode/[n]/page.tsx`) rebuilt: outer `flex-col md:flex-row`, cover+title in a `min-w-0 flex-1` group, and the prev/next `nav` drops to its own row below `md` — at 375 the worst case (Chiikawa Ep 358, 3-digit + both arrows) stopped forcing "Episode 358" and the airing date to wrap; inline on the right at ≥ 768. **44 px touch targets below `md`** on every thread control, compact restored at `md:` (twMerge dedupes the base `h-8`/`h-7` vs `h-11`): composer timestamp input / Spoilers label / submit (thread-view.tsx), the Chronological/Timeline sort toggle, comment reaction chips + `+` picker (min-h/​min-w-11) + Reply/Delete (comment-item.tsx), the prev/next pills, and the episode-list rows (`episode-list.tsx`, the thread entry point; `items-center md:items-baseline` so the taller row centers). Emoji-picker popover got `flex-wrap max-w-[calc(100vw-2rem)]` so the bigger 44 px buttons can't overflow the viewport (residual: a popover opened from a far-right, heavily-reacted `+` can still clip — Parking lot). **Breakpoint = `md` (768)** deliberately, to match M0.3's bottom-nav boundary (`md:hidden`) so 640–768 (landscape phones) isn't a mixed "mobile nav + compact controls" band. Grids (AnimeGrid) already fine at 375 from M0.2. All changes are structural (flex/min-h/breakpoints), so light == dark by construction (preview can't screenshot light — M0.3). Verified in preview at 375/768/1440/2560; typecheck/lint/12 vitest green. **Not done:** app-wide button/input mobile sizing — the anime-detail action bar (Add to list/favorite/Discussion/Write review = 32–34 px) and other pages still use the compact scale; consistent fix belongs at the primitive level (→ Parking lot), not scattered page-by-page.
- 2026-07-06 · M0.3 · New `components/bottom-nav.tsx` (client): fixed `md:hidden` tab bar — Home `/` (exact) · Seasonal · Search · My list + a Menu tab opening a bottom `Sheet` with the links the collapsed header drops (Schedule/Trending/Hidden Gems, + Feed/For you when authed); active tab = filled icon + `text-primary` (bell's pattern), `aria-current`, 64 px bar so every target ≥ 44 px. Header nav is `hidden md:flex`; bell+avatar wrapped in `ml-auto` cluster; tagline now `lg:inline` only (at 768 it forced the nav row into a 42 px scroll). Safe-areas: `viewport` export (`viewportFit: "cover"`) + env() padding on header top, bar bottom/l/r, sheet bottom; body gets `pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0` so content/footer clear the bar. Toaster: `position` flips top-center/bottom-right via new `lib/hooks/use-is-mobile.ts` (`useSyncExternalStore` matchMedia < 768) + `mobileOffset` top safe-area calc. 4 vitest tests (tabs/active/sheet/authed-menu). Verified in preview at 375/768/1440, dark + light-via-inspect (the preview screenshot pipeline force-darkens light pages — computed styles are the source of truth; a real light screenshot needs a normal browser). Also: fixed `Taskfile.yml` line 24 — unquoted `{{.CLI_ARGS}}` in a flow array is invalid YAML, `task` couldn't parse the file at all (pre-existing since scaffold; quote such entries). Committed the prior session's uncommitted side-rail parking-lot note. M0.4 note: bar/header/toaster done — audit composer row, thread header, tap targets page-by-page.
- 2026-07-06 · M0.2 · New `components/page-shell.tsx` (`browse` `max-w-[88rem]` / `reading` `max-w-3xl` / `form` `max-w-xl`) replaces the one-size `max-w-6xl` `<main>` shell; root `<main>` is now bare `flex-1` and each of the 16 content pages wraps its content in `PageShell` (root `<div>` merged into it via `className`, or wrapped where `<article>`/client semantics must stay). `AnimeGrid` + the search-skeleton grid → `grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]` (reproduces the old 2→6 breakpoints and scales to 8 cols on the wide shell). Header/footer track `max-w-[88rem]`; `(auth)` layout gained `px-4` (main no longer supplies it); feed/notifications lost their self-centering `mx-auto max-w-2xl` (now the reading column); settings kept `max-w-xl`. Preview-verified at 375/1440: browse 1408 / reading 768 / form 576, header 1408 over the 768 reading column, `AnimeGrid` 8 cols @1440 & 2 cols @375 with no h-overflow, anime-detail `-mx-4`/`-mt-6` banner bleed intact, login padded at 375, 0 console errors. typecheck/lint/vitest all green.
- 2026-07-06 · M0.1 · Delayed `Skeleton` (globals.css `.skeleton`: opacity-0 → 150 ms fade, then pulse; replaces `animate-pulse`; reduced-motion keeps the delay, drops the pulse) + `keepPreviousData` on `useMyList`. Verified logged-in in the dev preview at 375 px + desktop: 0 skeletons across 5 tab switches incl. never-fetched tabs; typecheck/lint/vitest green. SSR-prefetch **deferred** — one-time rotating refresh tokens + an RSC render can't re-set the rotated cookie, so a server-side refresh would revoke the client session; needs a non-rotating SSR read path (→ Parking lot). Prod-build A/B repro not re-run (needs a web-image rebuild); hypothesis B (skeleton flash) is code-confirmed and the two fixes apply regardless (§M0). Env notes for next session: `web/node_modules` was half-linked — `pnpm install` relinked it; `cour-web` launch config gained `autoPort` (Docker holds :3000 when the compose stack is up).

### Parking lot

<!-- Mid-session ideas land here instead of in the diff. -->

- **Palette / brand pass** (from the 2026-07-07 review) — the
  violet-on-near-black theme is clean but trend-adjacent (the fashionable
  dark-purple of the Linear era). Deliberately deferred: it's all CSS
  variables in `globals.css` (an afternoon to swap), and M3.1's landing
  page forces the real brand question anyway. Typography (M2.4) is the
  actual de-generic-ing lever; revisit color after M3, and prefer letting
  cover artwork carry color (ambient poster glow on hover, artwork-tinted
  headers — the anime-detail banner already proves the effect) over a
  louder static palette. The visual signature worth building toward is
  **time/liveness** (countdown chips, LIVE states, decay), not a hue.

- **Typing indicator** (deferred from the 2026-07-07 thread-UX session) —
  "@user is typing" with a three-dot pulse in ThreadView, the last big
  iMessage-feel piece. Needs a throttled client signal (a tiny
  `POST /threads/{id}/typing`, throttle ≥ 2 s — keep it off the composer's
  keystroke hot path) + an ephemeral `typing` event through the existing
  `internal/realtime` hub (no persistence; client drops the indicator ~4 s
  after the last signal). Natural fit alongside M2.3's thread work, or ride
  M4.1's presence plumbing if that lands first.

- **AniList rate budget vs. interactive imports** (from M1.3) — while the
  22k-title backfill re-crawl runs (hours after a cursor reset; also the
  6-hourly delta bursts), the shared AniList client rate budget starves an
  import job's `UserList` fetch: observed live as 429s through every asynq
  retry until the final-retry backstop failed the job with "processing
  failed repeatedly". Options when it matters: a small reserved slice of
  the budget (or a priority lane in the client's limiter) for interactive
  fetches, or pausing backfill chunks while an import job is pending.
  Rare in steady state — backfill only re-runs on migrations like M1.1's.

- **Import-job retention** (from M1.2) — done/failed/superseded `import_jobs`
  rows accumulate forever, each carrying up to a few MB of rows jsonb (10k-row
  cap × ~200 B/row). Harmless at current scale; when it matters, a small
  worker cron (`@every 24h`) deleting terminal jobs older than ~30 days is
  enough. Keep at least the most recent job per user so "what did my last
  import do" stays answerable from Settings → Import (M1.3 may link it).

- **App-wide mobile tap targets** (from M0.4) — the compact design scale
  (`Button` `h-8`/`sm` `h-7`, `Input` `h-8`) means most non-thread controls
  are 28–34 px on touch: the anime-detail action bar (Add to list /
  favorite / Discussion / Write review), and presumably my-list tabs+rows,
  search, settings, filter chips. M0.4 fixed the *thread surface* only.
  Doing the rest page-by-page would leave the app inconsistent (some 44 px,
  some 32 px), so the right fix is at the **primitive level**: give
  `Button`/`Input` a mobile-default height (`h-11 md:h-8`, matching the
  M0.3/M0.4 `md` boundary) or a dedicated touch size, then re-verify each
  page's layout at 375/768/1440 (a header/nav/card/form-wide change — its
  own task, not a drive-by). Keep the compact scale for pointer (≥ `md`).

- **Reaction-picker edge clipping** (from M0.4) — the emoji popover is
  `position: absolute` anchored to the `+` trigger with no edge detection.
  M0.4 capped its width (`flex-wrap max-w-[calc(100vw-2rem)]`) so it can't
  exceed the viewport, but a popover opened from a `+` sitting far-right
  (a comment with several reaction chips before it) can still clip its right
  edge on narrow screens. Proper fix: flip anchor side / shift-into-view
  (a small `useLayoutEffect`, or Radix `Popover`/`DropdownMenu` with
  collision handling instead of the bare `<details>`).

- **SSR session/list hydration** (deferred from M0.1) — prefetch the
  signed-in list on the server so the list page arrives populated, *without*
  tripping refresh-token rotation. Refresh tokens are one-time-use with
  family-revocation, and an RSC render can't set the rotated cookie, so a
  naive server-side refresh logs the user out. Options: a Next middleware
  that refreshes and hands the access token to the render via a request
  header, or a short-lived non-rotating SSR read token. Bonus: also lets
  `app/page.tsx` render the authed home shell without a client refresh
  round-trip (helps M3's cookie-branch routing).

- **Desktop side rail** (the wide-screen margin) — the `max-w-[88rem]`
  browse cap leaves large side margins past ~1680 px. Add a rail *at the
  end*, not now, and in this build order: (1) **M0.5** — a filter rail
  (genre/format/weekday) on seasonal/browse, collapsing to chips / a bottom
  sheet on mobile; filters don't compete with posters the way a content
  panel would. (2) **M2** — a presence/progress rail on the thread pages
  (the `max-w-3xl` reading column has the *most* dead side space): "N here
  now", prev/next episode, your progress + spoiler state, related threads.
  (3) **M3** — a persistent "Tonight" rail (live-now threads, your evening,
  continue-watching) across browse pages. Cautions: cold-start (an empty
  "live" rail looks *dead* — wait for M2's velocity/presence to fill it,
  per the room-model decision) and mobile-first (nothing essential may live
  only in the rail). Avoid a rail on the seasonal chart itself — it steals
  the auto-fill grid columns M0.2 just added.

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
- ~~SSR-prefetch the first `/list` tab~~ — **deferred** (M0.1). Prefetching
  an authed endpoint server-side means running the refresh-cookie exchange
  during SSR, but refresh tokens are one-time-use with family-revocation on
  reuse ([`auth/service.go` `Refresh`](../backend/internal/auth/service.go))
  and an RSC page render can't set the rotated cookie back on the response.
  The client's own mount-time `refreshSession()` would then replay the
  now-used token and get the whole session revoked — logging the user out on
  every visit to a prefetched page. Safe hydration needs a non-rotating SSR
  read path (middleware refresh + header hand-off, or a short-lived server
  token); that's its own task — see the Parking lot. The delayed skeleton +
  `keepPreviousData` already remove the flash without it.

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
  any thread (same pattern M4's rooms will reuse). The discussion HTTP
  handlers publish after the service commits — kept in the handlers (not the
  service) so the events reuse `toComment`/`toThread` and match the REST
  shapes the client caches. Built with one `PSUBSCRIBE thread:*` per instance
  (see M2.1 log for the trade-off vs. dynamic per-thread SUBSCRIBE).
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
already-loaded list entry — no schema change. **Blur-all must include the
reply quote chips** (thread-UX session, 2026-07-07): every reply renders a
one-line quote of its parent's body via `CommentsIndexContext`, so an
unblurred chip would leak a blurred comment's text; the chips already show
an italic placeholder for `has_spoilers`/deleted parents
(`comment-item.tsx`) — extend that same path. (M2.3 decisions: the shield
also covers the **composer's reply-to chip** — quoting a hidden comment in
the composer leaks it the same way; *known-upcoming* episodes skip the
guard, the speculation banner owns those, but a null `airing_at` still
guards — a finished show without per-episode dates is aired; completed
entries never guard.) Companion feature: when
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

## M2.4–M2.6 — UI identity + scale inserts

Added 2026-07-07 after a live walk-through. The verdict on the app's look:
clean but anonymous. The diagnosis is **not** the palette — near-black with
violet accents is fine, all CSS variables, swappable in an afternoon
(rebrand deferred → Parking lot). It's two other things: (a) **JetBrains
Mono is the body font for everything** — synopsis paragraphs, comments, nav
— which reads "developer terminal" rather than "anime community" and hurts
long-form readability; (b) **uniform visual weight** — same card, border,
radius on every surface. The identity worth amplifying instead is *time*
(countdown chips, airing-next, live threads, decay-based trending): no
competitor is organized around liveness, and those elements are already
the most distinctive things on screen.

Also in this batch: two scale fixes from the same session (Miguel's ask) —
long-running shows break both the episode list and, eventually, threads.

### M2.4 — typography split

Mono for **data**, sans for **prose**:

- Load a proper sans (next/font, subset) as the body/prose face; prose
  headings move with it. Keep JetBrains Mono exactly where it's the
  identity, not the obstacle: timestamps, countdown/airing chips,
  episode + stat counts, scores, usernames-as-handles if it reads well.
- Mechanically: `globals.css` `@theme` font variables + the few explicit
  `font-mono`/`font-heading` call sites. No layout changes.
- Verify the long-form surfaces (synopsis, thread comments, reviews) and
  the data surfaces (cards, schedule, countdowns) at 375/desktop — the
  contrast between the two faces should *increase* the sense of intent.

### M2.5 — episode pagination + latest-first

[`EpisodeList`](../web/components/anime/episode-list.tsx) mounts every
episode row in ascending order — a One Piece-scale title (1000+ eps) means
minutes of scrolling to reach the episode people are actually discussing
tonight.

- **Newest-first default**, asc/desc toggle. Client-side — the detail
  payload already carries the full episode array.
- **Range pages, not page numbers**: chips of 50 ("1051–1100 · 1001–1050 ·
  … · 1–50"), newest range active by default — ranges are how people think
  about long anime ("the Wano eps"). Titles with ≤ 50 episodes render
  exactly as today, zero added chrome.
- **"Latest episode" button** in the detail action bar, next to
  Discussion → `/anime/{id}/episode/{latest aired}` (highest `airing_at`
  in the past; fall back to highest number when nothing has aired).
- Optional: URL-sync range/order (M0.5's param pattern) so links share.

### M2.6 — thread comment pagination

Comments currently arrive as one `ORDER BY id LIMIT 500` fetch — thread
501+ comments silently vanish. Fine yesterday, wrong for the product whose
whole thesis is big live threads.

- Cursor pagination on the comments endpoint (`before_id`/`after_id`,
  keyset — the id ordering is already the arrival ordering), newest page
  first to match the client's Newest default; a "load older" affordance
  at the list tail.
- **Interplay to respect:** the reply-tree builder assumes a parent is
  always in the loaded set (parent id < reply id — loading newest-first
  can orphan replies whose parents are on an unloaded older page; either
  fetch-parents-on-demand or group orphans under a stub quote chip).
  Top/Timeline sorts compute over the *loaded* set — label them
  accordingly ("top of loaded") or fetch-all for those modes under a
  size cap; decide in-session, note the choice here. Live SSE merge is
  unaffected (events fold into the loaded cache; the M2.2 helpers are
  idempotent).
- Spec-first: the endpoint change enters `openapi.yaml`; `task gen`.

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
   discussion stats ("312 comments this week"). Companion sub-row:
   **"Back in the conversation"** — titles in the trending top-N whose
   season ≠ current (the TikTok-revived 2013 show). Trending Now is
   already all-catalog (AoT/MHA rank today), so this is a filter + label,
   nearly free — it tells the viral-revival story explicitly instead of
   silently mixing old shows into the grid. An all-time "popular" tab was
   considered and **rejected**: MAL/AniList own the hall-of-fame list;
   recency is the differentiation.
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

### Thread texture (M3.4)

The episode thread is the product's heart and its most spartan page.
M2.2/M2.3 make it *behave* alive; this makes it *look* alive:

- **Timestamp-density strip** — a mini episode timeline above the
  comments showing where the `12:34`-anchored discussion concentrates
  (SoundCloud-waveform style); clicking a cluster jumps the list (reuse
  `jumpToComment` + `comment-flash`). Built entirely from data already
  collected, and the one genuinely novel visual in this space — nobody
  else has progress-timestamped episode discussion. Hidden when a thread
  has no timestamped comments; honors `prefers-reduced-motion`.
- **Empty state** — replace "No comments yet — first!" with something
  alive: airing countdown for upcoming episodes, presence count when
  anyone's in the room, a be-first nudge. Dead air is the enemy.
- **Live-window header** — within ~24 h of `airing_at`, the thread header
  gets a LIVE badge + M2.3's velocity ("N/min"). The M2.3 stretch
  night-of badge marks *comments* in the permanent record; this marks
  the *room* while the ritual is happening.

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
