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

- [x] **M2.4** (O) Typography split — JetBrains Mono stops being the body
  font: prose and prose headings move to a real sans; mono stays for data
  (timestamps, countdowns, ep/stat counts, scores). One `globals.css` +
  font-loading change, then an app-wide re-verify at 375/desktop.
- [x] **M2.5** (O) Episode list pagination — newest-first default with
  asc/desc toggle, range pages of 50 (newest range active), "Latest
  episode" jump in the detail action bar next to Discussion. One Piece
  scale (1000+ eps) is the acceptance test. (Verified live at 375/desktop
  against a 1169-ep One Piece.)
- [x] **M2.6** (O) Thread comment pagination — replaced the silent
  `LIMIT 500` truncation with newest-first keyset pages (`before_id`/
  `next_cursor`) + "load older"; live merge and the four sorts keep working
  over the loaded set, orphan replies promote to display roots with an
  "earlier comment" stub, honest scope note when older pages are unloaded.
  (Verified live at 375/desktop against a 60-comment thread.)

### M3 — home & landing

- [x] **M3.1** (F) Landing + routing — session-cookie branch in
  `app/page.tsx` (via a new `cour_session` marker — the refresh cookie is
  path-scoped and never reaches page requests; spec §M3 amended), hero,
  live-proof ticker, tonight strip, busiest threads, seasonal preview,
  no-streams promise, SEO metadata. (Verified live 375/desktop, anon +
  authed round-trip.)
- [x] **M3.2** (F) "Tonight on Cour" — your-evening row (spotlight +
  countdowns), live-now rooms panel, continue-watching with inline `+1`,
  the season's conversation with talk stats, compact existing strips,
  **"Back in the conversation" row** (trending titles not from the current
  season — the viral-revival story told explicitly; see §M3). Verified live
  375/1440 as sakuga_sam incl. the quiet-night and +1 flows.
- [x] **M3.3** (O) Onboarding + threads hub — post-register `/welcome`
  pick-your-shows grid (Airing-now / All-time-popular tabs + catalog search,
  seeds the watching list, skippable) + import CTA, `/threads` hub (opening
  tonight + busiest this week), Threads in the desktop header nav and the
  mobile Menu sheet. (Verified live 375/1440, anon + authed; no demo-DB writes.)
- [x] **M3.4** (F) Thread texture — timestamp-density strip (40-bucket
  waveform + cluster-region buttons jumping the list via `jumpToComment`),
  dressed empty state (ticking airing countdown / presence / be-first
  nudge), SSR LIVE pill in the episode header + comments-per-minute
  velocity in the thread vitals within 24 h of airing. (Verified live
  375/1440 against a SQL scaffold; demo DB restored.)
- [x] **M3.5** (F) Profile revamp — banner + accent color from the owner's
  favorites, elevated bio, interactive stats (score histogram, watch time,
  clickable genre bars), public library tabs (watching/completed/dropped/…
  as a browsable poster wall), dressed empty states. Spec in §M3.5;
  needs small API/schema deltas (spec-first). (Verified live 375/1440 as
  owner + visitor + fresh zero-list account; demo DB restored after.)
- [x] **M3.6** (F) Profile personality — taste statistics (score bias vs the
  community, use of the scale, per-genre mean, eras, formats, habits,
  milestones), owner-picked accent from a favorite's cover art, bio editable
  in place, count-up on the headline numbers; hero-glow and profile-banner
  alignment fixes; favoriting given a label and a second home in the list
  dialog. Spec in §M3.6.
- [x] **M3.7** (F) Visual refresh — teal + ink palette replaces night-violet
  (all theme tokens, both modes), rounded primitives (`--radius` 0.75rem,
  every shadcn `rounded-none` → md/lg/xl/full), calmer hero wall (55 %
  opacity, ~2× slower, 26 distinct covers × 2 reps instead of 18 × 3),
  seasonal rail is one scrollable row (no 4-copy marquee), and the
  landing gains a self-running **product tour** (live room · spoiler
  shield · tonight + notifications), a three-step "how it works" strip
  and a closing CTA band. Spec in §M3.7. Resolves the Parking-lot
  "Palette / brand pass".
- [x] **M3.8** (F) Come-back loop + discovery restructure — (a) **Your
  pulse** on the signed-in home: `GET /me/pulse` (streak on the viewer's
  calendar, badge catalog + next-badge progress, replies to your comments,
  reactions your comments drew); (b) **Rooms hub** rebuilt: ranked hot list
  with podium + heat bars, sort, title filter, and a "My shows" view (every
  room for your list, hot or quiet) that only exists there; (c) **Schedule**
  as a day strip + lens (My shows / Popular / Everything) instead of a
  seven-day wall; (d) **Trending** = 12 explained cards via
  `GET /trending/explained` (signal chips + "why for you": followees, your
  status, shared genres) with an "also rising" tail; **Hidden gems** drop
  music, dock shorts/OVAs/specials, exclude the trending top-50, and get
  format chips + a per-card reason. Spec in §M3.8.

### M4 — watch parties ([design](WATCH_PARTIES.md))

- [ ] **M4.1** (F) WS gateway + presence, flag-gated
- [ ] **M4.2** (F) Shared clock — host controls, drift correction
- [ ] **M4.3** (O) Live chat + reactions + opt-in persistence into threads
- [ ] **M4.4** (O) Room lifecycle + discovery (episode page, schedule, home)

### Session log

<!-- One line per completed session: date · task · outcome / notes for the next session. -->

- 2026-09-04 · M3.8 · Come-back loop + discovery restructure (Miguel's four
  asks: the signed-in home needs a reason to return, threads is a bulletin
  board, schedule is too much about too many shows, trending/gems overlap).
  **Backend (spec-first, `task gen` clean):** `queries/pulse.sql`
  (active days in the viewer's zone via `AT TIME ZONE @tz::text`, one
  badge-counters query of scalar subqueries, replies-to-user join through
  `comments.parent_id`, top-reacted comments this week), new package
  `internal/pulse` (pure `computeStreak` — current run survives an
  unfinished today, best = longest run ever; `evaluateBadges` — 14-entry
  catalog, next = highest progress ratio, ties to the cheaper target;
  `_ "time/tzdata"` embedded because the API image is Alpine-thin), handler
  `GET /me/pulse?tz=`. `discovery/explain.go` + `GET /trending/explained`
  (optional auth via `identity(r)`; `ActivitySignals` grouped counts in the
  window; `FolloweesOnList`, `UserListStatusFor`, reuse of
  `UserGenreBreakdown` top-5 for shared genres, capped 2). `HiddenGems` SQL:
  `format <> 'MUSIC'`, `ORDER BY score - CASE format (TV/MOVIE 0, ONA 3,
  else 6)`; `RecomputeHiddenGems` excludes the trending ZSET top-50
  (`ZRangeArgs{Rev}` — `ZRevRange` is deprecated per staticcheck). Go unit
  tests for streak/badges/snippet/sharedGenres/addSignal; golangci clean.
  **Demo data:** inserted 3 replies to sakuga_sam + 20 reactions on their
  comments via SQL (not the seeder) so the pulse has texture; the gems
  cache had to be `DEL`ed once — its key has no TTL and the old order was
  served until the recompute. **Web:** `lib/pulse.ts`, `lib/schedule.ts`,
  `lib/trending.ts`, `lib/gems.ts` + `threads-hub.ts` view helpers
  (`sortRooms`/`filterRooms`/`hubStats`/`myRooms`), all unit-tested (277
  vitest). `LiveRoom` gained `animeId/kind/episode/lastActivityAt`.
  `app/home/pulse.tsx` (client island, `["pulse"]` query keyed off the
  session; streak card with `.pulse-glow`, badges + next-badge bar, replies
  + kudos line); `app/threads/threads-hub.tsx` (views Hot/Tonight/My
  shows/Series talk, sort select, filter input, podium of 3 + ranked rows,
  heat bar = recent/max); `app/schedule/schedule-view.tsx` rewritten (day
  strip with per-day counts, lens defaults to My shows when the viewer's
  week is non-empty else Popular = top third of distinct shows;
  `components/anime/schedule-days.tsx` deleted); `app/trending/trending-
  client.tsx` (query keyed by session status so `you` fills after auth
  resolves; top 12 explained cards, ranks 13–30 as a compact grid);
  `app/hidden-gems/gems-client.tsx` (format chips + "★ 84 · only 1.2k on
  lists"). Shared `components/ui/chip.tsx` extracted from the seasonal
  view's local Chip (that file keeps its own). Verified in the preview at
  1280 and 375 for home/rooms/schedule/trending/gems as sakuga_sam (10-day
  streak, 6 badges, next Finisher 3/5, 3 replies, 20 reactions). **Next:**
  M4.1, or the M3.8 follow-ups in the Parking lot (episode_aired
  notifications → a "tonight" push; badge toasts on earn; the schedule's
  "Popular" lens could use trending rank instead of raw popularity).
- 2026-09-04 · M3.7 · Visual refresh, landing first then the signed-in home
  (Miguel's ask: teal instead of violet, darker/blacker surfaces, rounder
  buttons, a calmer/slower/less repetitive poster wall, and something that
  *shows* how the site works to capture newcomers). **Palette:** `globals.css`
  tokens only — dark bg `oklch(0.13 0.006 200)`, card `0.175`, primary
  `oklch(0.78 0.13 190)` (light: `0.52 0.11 190`); the old violet survives as
  `--chart-2` so multi-series charts keep a second brand-adjacent hue. Every
  `color-mix(var(--primary))` ambience/tint/bloom rule re-tinted itself, so
  home, profile and thread surfaces switched with zero per-page edits.
  **Radius:** `--radius` 0.625→0.75rem; a scripted pass over 20 shadcn
  primitives mapped `rounded-none` → button/alert/tabs-list `lg`, inputs/
  menu items/tooltip `md`, card/dialog `xl`, badge/progress/slider `full`,
  checkbox `[4px]`; the three survivors are deliberate (borderless inner
  input-group controls, line-variant tabs, tooltip arrow). Hero + CTA
  buttons are `rounded-full` pills on top. **Hero wall:** opacity 85→55 %,
  durations 110/150 s → 200/260 s, `REPS` 3→2 with `heroCovers` cap 18→26 so
  a half still outruns 2560 px (test updated 60→40 imgs). **Seasonal rail:**
  `SeasonalCarousel` rewritten as one snap-scrolling `<ul>` (no `inert`
  filler, test rewritten) and the landing shows 10 not 14; tonight strip
  12→8. **Tour:** new `app/landing/product-demos.tsx` (client) — three looping
  mock scenes driven by a `useStep(count, ms)` counter (`useSyncExternalStore`
  on the reduced-motion query freezes each scene on its finished frame — the
  `react-hooks/set-state-in-effect` rule rejects the naive
  setState-in-effect; interval idles on `document.hidden`). Fixtures are
  invented handles/quotes, never real members (the live panel's editorial
  rule holds), no links inside. Room scene is chat-style (`justify-end` +
  `overflow-hidden`, oldest clip off the top); toasts get their own tray
  under two evening rows rather than overlaying the list — both were overlap
  bugs in the first cut. `how-it-works.tsx` (server) is the three-step
  strip; closing CTA band with `.cta-ambient` replaces the old "deal" card
  (AniList credit moved into it; footer unchanged). 4 new vitest cases (copy,
  playback with fake timers, loop, reduced-motion hold). **Signed-in home:**
  inherits everything; only its live panel went `rounded-2xl` to match.
  Verified in the preview at 375 (no h-overflow, tour stacks 1-col) and
  1280×2700 tall viewport; 256 vitest / tsc / eslint green; Go untouched.
  **Preview gotcha (new):** while the Browser pane is *hidden* Chrome stops
  rAF, so CSS transitions/animations freeze mid-frame and any screenshot
  below the fold comes back solid black — verify state via DOM/data attrs
  and emulate a tall viewport (`resize_window` 1280×2700) for a full-page
  shot once the pane is showing; the thread-log "black screenshot" is not a
  page bug. Light-mode tokens were updated but the app is still dark-only
  (`enableSystem={false}`) — untested visually. **Follow-up (same day):**
  Miguel found teal too dominant → semantic accents `--live`/`--gold`/
  `--lilac` (+ `--color-*` in `@theme inline`, so `text-live`, `bg-gold/10`
  etc. are utilities). Scripted pass re-pointed every ping dot, presence
  line, LIVE badge, unread marker, countdown and ★ score across app/ and
  components/ (`text-primary` stays for links/CTAs); tour scenes carry one
  accent each; ambience glows use the other hues. Spec §M3.7 "Accents".
- 2026-07-09 · Hero readability refactor (supersedes M3.6's hero geometry; not
  a ledger task — the oval kept missing the copy as the window shrank). The
  wall mask no longer opens a hole and `splitLayout` is gone (prop, `-split`
  class, five-constant calc). Readability + bloom live on one copy-anchored
  element instead: `.hero-copy-backdrop`, `-z-10` inside the now-`isolate`
  copy column — a flat near-background plate melted over fixed-rem inset
  margins by a mask, plus the violet bloom whose x-center
  (`--hero-copy-focus`) slides to `min(20rem, 50%)` when the copy sets
  ragged-right at lg (5rem inset + half the 30rem h1). Why: wall coordinates
  can only chase the copy — the tuned hole's fully-cleared center was ~140px
  under a ~340px phone headline even with the anchor dead-on — while a child
  of the copy column binds to it by construction. §M3.6's glyph-rect
  measuring lesson still stands.

- 2026-07-09 · M3.6 · Profile personality + two alignment fixes. Full spec in
  §M3.6. **The hero bug generalized:** the bloom was `left-1/2` (viewport) but
  the copy sits in the left column at `lg`; the wall's mask hole chased it with
  a hardcoded `30%`, which is only right near 1440 (**74px off at 1024, 105px
  at 1920**). **First fix was wrong and Miguel caught it in a screenshot:**
  centring the bloom on the copy *column* (`calc(50% - 17rem)` — half the
  `30rem` panel plus half the `4rem` gap) is exact for the column, and still
  ~180px right of the words, because at 1440 the `h1` box is its `max-w-3xl`
  768px while `text-wrap: balance` leaves the glyphs at 470px (glyph centre
  **259**, column centre **441**). Lesson: measure
  `range.selectNodeContents(h1).getBoundingClientRect()`, not the `h1` box —
  the box lies. Real anchor is the headline's half-width from the column's left
  edge: `left: min(15rem, 50%)` on the bloom, `max(calc(50% - 28rem), 16rem)`
  for the mask hole (same point expressed from the section, since the column's
  left edge is `50% - 43rem` once `max-w-[88rem]` binds). Verified against
  glyph rects at 375/768/1024/1280/1440/1920: **delta ≤ 5px** wherever the
  bloom is narrower than the column, 0 below `lg`. `HeroPosterWall` takes
  `splitLayout` because only the caller knows whether the live panel claimed the
  right column. Profile fallback wall: `-rotate-2` gone, covers crop to the band
  height. **Backend (spec-first):** migration 000017 `users.accent_color` with a
  *lowercase* `#rrggbb` CHECK (service lowercases first, so the constraint fires
  on bugs, not users); `PATCH /me/profile` accent uses the avatar convention
  (`"" clears`, omitted keeps); 7 new queries. **sqlc nullability gotcha:** a
  `WHERE x IS NOT NULL` does not make sqlc type the column non-null — it types
  the *column*, not the predicate — so `UserFormatSplit` needs
  `COALESCE(a.format::text,'')::text`; likewise every mean is `COALESCE(AVG(…),0)`
  plus a `rated_count` so **Go**, not SQL, decides null-ness. `UserTopStudios`
  filters `is_main` (else everyone's house studio is Aniplex);
  `UserLongestCompleted` is `:many LIMIT 1` because an empty shelf is the common
  case, not `ErrNoRows`. New named schemas (`ScoreBias`, `GenreStat`,
  `SeasonCount`, `FormatCount`, `StudioCount`, `LibrarySpan`) so oapi-codegen
  emits real types instead of anonymous structs — `genres` moved from inline to
  `$ref` at the same time. Public list gains `year`+`format`; an era click also
  pins the tab to **completed**, which is all `season_counts` ever counted. Cache
  key **v2→v3**. **Withholding rules matter more than the stats:** bias needs ≥5
  shared-scored shows, stddev ≥2 ratings, a genre mean ≥3 — and every section
  hides itself on a shelf that can't support it, so a fresh profile shows no
  zeroes. **`CountUp` was the subtle one:** it renders the true value through
  React and animates `textContent` from a layout effect (SSR/no-JS/reduced-motion
  all truthful, no hydration mismatch). First cut kept `value` in the dep array
  and restored `fmt(value)` in cleanup — a mid-flight change then wrote the *old*
  value, re-zeroed, and stalled until re-intersection (**caught by test**). Now:
  deps `[]`, target+formatter in refs *refreshed in a commit-time layout effect*
  — writing refs during render trips `react-hooks/refs`, correctly, since
  rendering can be interrupted. **Tests:** +21 vitest on `lib/profile` helpers
  (incl. `criticVerdict` band edges, which need synthetic means: `7.65-8.0` is
  `-0.34999999999999964` and silently misses the boundary), +6 on `CountUp`
  (monotonic, retarget, survives inline-formatter re-render), +11 on
  `ProfileView` (era/format clicks, accent hover-preview, in-place bio); the
  profile suite runs **reduced-motion** so CountUp leaves real numbers where
  jsdom has no IntersectionObserver. New Go unit test on accent validation +
  `TestProfileTasteStats` integration (bias sample excludes community-scoreless
  shows; eras exclude the dropped movie but the span includes it; `is_main`
  studio wins; bad format/year → 400). All green: 252 vitest, full Go
  integration, golangci 0, `task gen` clean. **Env notes:** another chat held a
  `next dev` on B:\cour\web (Next allows one per directory), and its **stale
  fetch cache 500'd `/users/*`** on the new required fields — a dev-only
  artifact, gone on a fresh `docker compose up -d --build web`; screenshots also
  hang against that dev server while `read_page`/`javascript_tool` work, so the
  alignment fixes were verified numerically. Demo DB restored (the favorite test
  left one `activities` row — deleted; favorites back to 0, no accents set).
  000016 `users.banner_anime_id` (FK `ON DELETE SET NULL`); `PATCH
  /me/profile` takes `banner_anime_id` with the score-field convention (**0
  clears, omitted keeps** — spec §M3.5 amended: it was never PUT, and
  oapi-codegen pointers can't tell null from absent), unknown anime → 422;
  `UserProfile` gains resolved `banner {anime_id, banner_image,
  cover_color}|null`; `ProfileStats` gains `watch_minutes` (Σ progress ×
  `COALESCE(duration_min,0)` — an honest floor) + `score_histogram`
  zero-filled to all 10 buckets server-side; **profile cache key v1→v2**
  (shape change — stale JSON must miss). New public `GET
  /users/{username}/list` — offset pages of ≤50 with `total` via `COUNT(*)
  OVER()`, sorts updated/score(`DESC NULLS LAST`)/title(`lower(coalesce(
  title_english, title_romaji))`), plus **score+genre filter params beyond
  the sketch** so histogram/genre clicks stay honest across pages
  (uncached; keyset not needed at list scale). `toListEntryWithAnime`
  extracted (GetMyList now shares it). Tests: 2 new integration (histogram/
  watch-minutes/banner-lifecycle incl. cache-bust assert via re-GET;
  pagination walk asserting pages tile exactly + both filters + 404), all
  green. **One flake struck**: `TestMALImportZeroActivity` — near-equal
  trending scores swapped rank between recomputes; passed isolated + full
  rerun; unrelated to this diff → **parked "trending tie-break is
  nondeterministic"** with the one-line fix. **Web:** `page.tsx` is now a
  thin server shell → `ProfileView` client root (ThreadView pattern — the
  banner pick must repaint hero+accent instantly and stat clicks must land
  in the library, so one tree owns `--tint`, banner state, and the filter).
  Hero: full-bleed masked banner art (`profile-banner-mask` — mask-image
  melts, not painted washes; anime-detail's `-mx-4` bleed pattern) →
  fallback **static tilted poster-wall strip** (favorites∪watching, ≥4
  covers, first 6 `priority` — it's the LCP, warning was live) → ambient
  violet; avatar rides the band edge with a **tint ring** (`.tint-ring`
  unlayered to beat the utility). New `lib/profile.ts` (pure):
  `formatWatchTime`, `profileTint` (banner color → first favorite with
  one), `fallbackWallCovers`, `libraryTotal`, `nextListPage`.
  `ScoreHistogram` (bars rise once via `.stat-bar`; radix Tooltip hover =
  count+share; click → filter) + `GenreBars` (`.genre-fill` sweep, click →
  genre filter) + `LibrarySection` (**All tab + five status tabs** with
  mono counts — stat clicks land on All since an exact score cuts across
  statuses, filter = removable chip; sort select; `useInfiniteQuery` "Show
  more" pages of 50; "N of M" scope line; owner "Manage on My list →") +
  `BannerPicker` (popover; candidates = favorites' banner art via lazy
  `/anime/{id}` `["anime-preview",id]` staleTime ∞ — **no new endpoint**,
  AnimeSummary lacks banner urls) + `WatchingRail` (per-card own-cover
  `--tint` + radix Progress). Headings/numbers/active-tab all `.tint-ink`/
  `.tint-tabs` (spec's "colored by its owner's taste"; `color-mix` over
  theme vars, reduced-motion drops both bar animations). Tests: **239**
  vitest / 35 files (+26: 9 lib, 2 histogram, 5 library incl. tab-switch
  →`onFilterChange`, show-more append, filter-chip clear, zero-state,
  owner-gate; 7 profile-view incl. tint-from-banner/favorite-fallback,
  histogram-click→All-tab+chip+`score=8` fetch+scroll, genre-click,
  owner-vs-visitor, zero-list dressed; 3 test-infra gotchas worth
  remembering: **jsdom needs a ResizeObserver stub for radix Tooltip**,
  reset shared fetch mocks in `beforeEach` (call history leaks across
  tests), and testing-library's default matcher sees only *direct* text
  nodes — match `/follower ·/` not `/1 follower/`). `task lint` + `gen`
  clean. **Verified live** (api image rebuilt — migration 16 auto-applied
  on boot; fresh preview after killing a leftover dev server + `.next`
  wipe per precedent): sam@375+1440 anon/owner/visitor — poster-wall
  fallback first (sam has **no seeded favorites**; favorited JJK+FMA:B via
  API as sam to exercise the real path), picker lazy-fetched `/anime/{11,71}`,
  pick → PATCH 200 + hero/tint flip to `#e45d5d` instantly (no reload),
  histogram click → `?score=8` + All tab + chip + scroll (Miguel drove
  extra clicks live in the pane: score 7/6 + chip-clear all round-tripped),
  **TabsList wrap bug caught live at 375** (variant `h-8` clipped row 2
  under the sort select — fixed with `group-data-horizontal/tabs:h-auto`;
  the bare `h-auto` loses to the variant), fresh zero-list account
  dressed (ambient + CTAs), 0 console errors, no h-overflow, served CSS
  verified incl. reduced-motion. **Demo DB restored to byte-identical**
  (favorites+2 `favorite` activities deleted, banner NULL, throwaway user
  cascaded, redis `profile:v2:*` busted — activities back to 691/max 747).
  **SSR gotcha for next sessions:** `revalidate: 60` is
  stale-while-revalidate — after any server-side data change, the *next*
  load triggers the refresh and the one after shows it; don't chase
  "stale" bugs before two reloads. **Next (M4.1):** watch parties begin —
  WS gateway + presence behind `FEATURE_WATCH_PARTIES`, design in
  WATCH_PARTIES.md.
- 2026-07-09 · M3.4 · Thread texture. **New pure `lib/thread-texture.ts`:**
  `commentDensity` — non-deleted `12:34`-anchored comments bucketed into 40
  bars over an axis of 0:00→last stamp (runtime isn't in the payload; the
  discussion's own extent is the honest axis), adjacent busy buckets merged
  into clusters (earliest comment = jump target; the peak bucket's *real*
  stamp = the "around 12:34" label); `threadVelocity` — live comments/min
  over a 15-min window from the loaded pages, **span-shortened when
  `truncated` and even the oldest loaded comment is in-window** (a blazing
  newest-page-only thread would otherwise undercount), null under 3 (noise
  floor); `velocityLabel` (decimal < 10, rounded above); `withinLiveWindow`
  (aired ≤ 24 h — **clock read defaults inside the helper**;
  react-hooks/purity flags `Date.now()` in RSC render too, the isUpcoming
  pattern). **Strip (`timestamp-density.tsx`):** 40-bar waveform (height +
  opacity encode density; `density-grow` mount ripple via `--i` delay, off
  under reduced-motion) with **transparent cluster-region buttons overlaid**
  — thin bars can't be touch targets, cluster regions can (`max(w%, 1.75rem)`
  wide, full 48 px strip height); click = `jumpToComment(firstId)` + flash;
  self-hides with nothing stamped, `allowTimestamps` keeps it off series
  boards; sits above the composer. **Empty state:** the dashed "No comments
  yet — first!" → dressed room: upcoming eps get a ticking mono "Airs in
  1h 57m" (30 s cadence, flips to "Airing now") + "call it now, gloat later";
  aired rooms get "Quiet in here so far — the first comment sets the tone.";
  presence ≥ 2 adds a pulsing "N in the room right now". ThreadView grew
  `airingAt`/`upcoming`/`live` props (episode page passes them, series board
  defaults false). **Live-window header (spec amended in place):** SSR LIVE
  pill next to the header airing line; velocity chip in the thread vitals row
  beside presence — the split is deliberate, the client data lives there.
  Tests: **187** vitest / 27 files (+22: 14 lib incl. bucket/cluster/
  span-shortening/clock-skew, 3 strip incl. jump wiring, 5 thread-view:
  countdown room, presence room, velocity in/out of window, strip-jump-flash
  E2E-ish, no strip on series; the old empty-state sentinel swapped for the
  quiet-room copy). Go unit + `task lint` clean; **no `task gen`** (web-only).
  **Verified live** 375/1440 anon on this session's preview (no leftover dev
  server this time) against a 16-comment SQL scaffold on Dogul Wang ep-1
  (thread 240, aired 15 h ago): 4 clusters ("3 around 1:10" … "4 around
  18:40") matched the bucket math, cluster click scrolled to "THE CUT AT
  8:05" + flash, LIVE pill up, 0.4/min (6 recent comments), night-of chips
  riding along; PetitCure ep-16 (in ~2 h): ticking countdown + "2 in the
  room right now" via a second SSE connection; a 30 h-old ep + the series
  board: quiet-room copy, no LIVE/strip/velocity; reduced-motion override
  confirmed in the served CSS; 0 console errors, no h-overflow. **Scaffold
  deleted after** — comments back to max id 53, thread-240 counters reset,
  activities untouched at 689 (SQL inserts, no API posts — the M2.6 lesson);
  empty thread shells 240/216/(152 ep 27) left, harmless per precedent.
  **Next (M3.5):** profile revamp — full spec in §M3.5, **spec-first** (small
  API/schema deltas: `banner_anime_id` migration, histogram/watch-minutes
  stats, public `GET /users/{username}/list` → `task gen`).
- 2026-07-09 · M3.3 follow-up (Miguel's ask) · Onboarding for non-seasonal /
  returning fans. **The gap:** the picker only offered the current-season chart
  + a bare "Skip" — nothing for a long-term fan signing up between seasons who
  wants to seed a list or find older shows' threads. **The build
  (`app/welcome/onboarding.tsx`):** the picker gains a segmented **Airing now /
  All-time popular** toggle plus a **catalog search box** (debounced 250 ms,
  `useDebounced`), all over **one existing endpoint** — `GET /anime` browses by
  popularity when `q` is absent (the all-time-popular head, `per_page=50`,
  fetched server-side in `welcome/page.tsx` alongside the season chart) and does
  ranked fuzzy search with `q` (client `useQuery`, reused from search-client).
  **Selection is one shared `Set<number>` across all three views** — pick Death
  Note on the popular tab, search "cowboy" and add Bebop, clear search, and both
  survive back on the popular tab (verified live). Copy broadened ("shows you're
  watching — or classics you want to jump back into"); the skip button reads
  "Not watching anything yet" until something's picked. Everything still adds as
  `watching` via the same per-entry PUT path (status nuance for completed
  classics stays import's job — noted, not built). **Thesis decision (Miguel
  greenlit overriding the earlier rejection):** an all-time-popular list is now
  allowed **as a scoped onboarding/list-seeding aid only** — never assembled
  home/landing content, where §M3 item 4's rejection still stands; amended that
  section in place. **No `task gen`** — `listAnime` already existed, no
  openapi/schema touch. Tests: **165** vitest / 25 files (onboarding +2 → 6:
  tab-pool-switch, search-then-clear-keeps-the-pick; existing skip test now
  targets the "Not watching anything yet" label; `useDebounced` mocked to
  identity so search resolves sync). lint/tsc clean. **Verified live** 375/1440
  as sakuga_sam: All-time-popular renders AoT/Demon Slayer/JJK/Death Note/MHA/HxH,
  search fuzzy-matches Cowboy Bebop, selection persists across tab↔search,
  controls stack on mobile, sticky bar clears the tab bar, 0 console errors, no
  h-overflow — **no demo-DB writes** (toggled but never submitted). **Next
  (M3.4)** unchanged: thread texture.
- 2026-07-09 · M3.3 · Onboarding + threads hub. **Onboarding
  (`app/welcome/`):** register now routes to `/welcome` instead of `/`
  (`register-form.tsx`); the server shell fetches the current-season chart,
  sorts by popularity, caps 60, and hands it to `<Onboarding>` — a client
  picker where each poster is an `aria-pressed` toggle (local `Set<number>`),
  a sticky action bar shows the live count + Skip/Add, and "Add N & finish"
  runs one `Promise.allSettled` of per-entry `PUT /me/list/{id}
  {status:"watching"}` writes, then toasts the real success count and
  `router.push("/")`. **Deliberately the normal per-entry path, not the
  M1 activity-bypass:** a handful of genuine "I'm watching this" picks *should*
  write `status` activities — the zero-activity rule is about bulk imports of
  arbitrary size, not manual onboarding. Skip/anon both leave cleanly (anon →
  sign-in prompt; page is `robots:noindex`). Discord OAuth still lands on `/`
  (backend-controlled redirect, left alone). **Threads hub (`app/threads/`):**
  server shell over `/schedule` + `/threads/trending?limit=20`. New pure
  `lib/threads-hub.ts` `tonightRooms` (tonight window ∩ schedule, soonest-first,
  enriched with presence/comments from `roomStatsByEpisode` when the episode
  thread is already trending) feeds `<TonightRail>` — a client island only
  because the countdowns tick (a just-aired room flips to a pulsing LIVE badge;
  `aired` frozen at mount via lazy `useState(()=>Date.now())`, the
  purity-safe clock read — `Date.now()` inside a `useMemo` factory *is* flagged
  by react-hooks/purity, unlike the state-initializer/`new Date()`-in-memo
  cases, so don't reach for useMemo there). "Busiest this week" reuses the
  landing's `buildRooms` verbatim, rendered as a static server grid (rooms,
  never quotes — same editorial rule). Both grids 1/2/3-col; honest empty
  states each. **Nav:** Threads added to `site-header` nav (after Seasonal) and
  as the *first* browse link in `bottom-nav`'s Menu sheet (`ChatsCircleIcon`).
  Kept the 4-tab thumb bar intact — promoting Threads to a thumb slot displaces
  a deliberate destination; parked as a possible follow-up. **Server-component
  icon gotcha:** import phosphor from `@phosphor-icons/react/dist/ssr` in RSCs
  (`ChatsCircleIcon` is there) — the main entry is `"use client"`. Tests: **163**
  vitest / 25 files (+10: 3 `threads-hub` incl. window/sort/stat-enrichment,
  3 `TonightRail` incl. LIVE-vs-upcoming + hot/quiet copy, 4 `Onboarding` incl.
  toggle-count, per-pick PUT payloads, skip-writes-nothing, anon prompt;
  bottom-nav test asserts Threads in the menu). `task lint` (eslint + tsc)
  clean; **no `task gen`** — web-only, no openapi/schema touch. **Verified
  live** on this session's own `next dev` (a leftover next-dev from a prior
  session held the Next-16 workdir lock — killed per the M2.4/M3.2 precedent
  before `preview_start`; compose web on :3000 is a stale image, use the native
  preview) at 375 + 1440, anon and as sakuga_sam (fetch-login per the
  react-hook-form note): `/threads` both sections render (Frieren series/ep-10
  rooms + a 5-comment tonight room cross-referenced), 3-col desktop / 1-col
  mobile, no h-overflow, 0 console errors; header + Menu-sheet Threads links
  resolve; `/welcome` picker renders 60 tiles, toggle → "2 picked" /
  "Add 2 & finish", sticky bar clears the tab bar, import CTA → /settings/import.
  **No demo-DB writes** — verified the picker toggles (local state) but never
  submitted the add. **Next (M3.4):** thread texture — timestamp-density strip,
  richer empty state, live-window LIVE badge + velocity in the thread header
  (spec §"Thread texture (M3.4)").
- 2026-07-08 · M3.2 follow-up (out-of-band, Miguel's asks) · Evening
  timeline + quiet-night recs + M3.5 spec'd. **(1) Physical timeline**
  (`app/home/evening-timeline.tsx`, `lg`+ only — under `lg` the rail cards
  stay; hover previews don't translate to touch): 25 h axis as pure
  geometry in `lib/home.ts` — `timelineMarks` (pct positioning + greedy
  collision lanes, max 3, LRU reuse past that), `timelineTicks` (half-hour
  grid, hour/midnight flags — midnight tick labels the *weekday*),
  `timelineNowPct`; component adds the pulsing now-line, stems tying each
  cover to its exact minute, hover/focus preview card (`role=tooltip`,
  `aria-describedby`, Escape closes) with airing facts, ticking countdown,
  genres, room presence, and a **lazy synopsis** —
  `["anime-preview", id]` query (staleTime ∞) hits `/anime/{id}` once per
  show per session; marks are links into the thread; axis re-anchors every
  60 s. Verified live with a 3-way simulcast collision (lanes 0/1/2
  confirmed) + preview fetch sampled. **Positioning gotcha:** translate the
  positioned `li` (anchor is its *left* edge), not the inner link — a
  `-translate-x-1/2` on the child leaves stems 20 px off-minute.
  **React-event gotcha (preview tooling):** `onMouseEnter` is delegated —
  dispatch `mouseover` with `bubbles:true` from `preview_eval`, raw
  `mouseenter` never reaches React. **(2) Quiet night un-emptied**
  (`quiet-night-recs.tsx`): below the week-ahead rail, a picks rail from
  `/me/recommendations` (queryKey `["recommendations"]` shared with the
  For-you page cache; seasonal fallback while cold; skeleton while
  pending) — copy switches "picked for your taste" / "big this season";
  the week-clear case keeps recs too. Live: sam's quiet night now shows
  DIGIMON (Sat) + HxH/etc. picks. **(3) M3.5 Profile revamp** written into
  the ledger + a full §M3.5 spec (banner-from-favorites hero w/ masked
  poster-wall fallback, `--tint` accent from banner/favorite cover_color,
  elevated bio, interactive stats: score histogram → filters library,
  watch-time total, clickable genre bars, stretch seasonal spread; library
  status **tabs** as the quick-browse ask; API deltas spec'd:
  `banner_anime_id` migration + `ProfileStats.score_histogram`/
  `watch_minutes` + public `GET /users/{username}/list`). Tests: **153**
  vitest / 22 files (+9: 3 timeline-math incl. TZ-safe midnight bound, 3
  timeline component incl. lazy-fetch-once + Escape, 2 recs incl. seasonal
  fallback, +1 your-evening week-clear case; float-pct asserts use
  `toBeCloseTo`), lint/tsc clean. Verified 375/1440; scaffold (5 rows incl.
  the 22/158/197 simulcast trio) SQL-inserted and deleted; activities
  count 689 before and after — demo DB clean. **Next (M3.3)** unchanged;
  M3.5 queued behind M3.4.

- 2026-07-08 · M3.2 · "Tonight on Cour" — `home-view.tsx` rebuilt as server
  shell + client islands (the access token never leaves the browser, so the
  personal rows resolve client-side over one shared `useMyList("watching")`
  query; SSR emits skeletons, no hydration risk). **New `lib/home.ts`** (pure,
  10 unit tests): `myTonight` (tonight window ∩ watching, just-aired sorts
  *first* — that room is live now), `nextUpLater` (beyond-24 h, deduped per
  show), `continueWatching` (watchable cap = `next_airing_episode − 1` |
  FINISHED count | NOT_YET_RELEASED 0, permissive on unknowns, recency sort —
  demo's "Here U Are" is NOT_YET_RELEASED with progress 4, a seed quirk the
  cap correctly excludes), `splitConversation` (undated titles ride the main
  row — the revival label must be provable), `talkStatsByAnime` /
  `roomStatsByEpisode` / `pulseStats`, `greetingFor`. **The page:** header
  (h1 + client greeting + live pulse line "N comments in 48 h · M in rooms"),
  *Your evening* — soonest episode as a **spotlight card** (cover-color stage
  lighting via `--tint` + `color-mix` classes `.tint-card`/`.tint-glow` in
  globals.css, 30 s-ticking `Countdown`, LIVE ping once aired, room
  presence/comments, one 44 px CTA) + tinted rail tiles; *Live now* —
  `buildRooms`/`LiveRooms` reused **verbatim** as M3.1-fu3 predicted (spec
  §M3 item 2 amended: rooms, never comment snippets, per the
  editorial-safety rule); *Continue watching* — per-show tinted cards,
  radix Progress bar, `+1` fires `{status:"watching", progress: nextEp}`
  with a `tapback-pop` on the count (progress-keyed span), "Discuss ep N";
  *The season's conversation* — `ConversationGrid` = `AnimeCard` + talk-stat
  line linking the show's hottest thread; *Back in the conversation* —
  revival titles with mono season chips (Frieren Fall 2023 / AoT Spring 2013
  / Demon Slayer Spring 2019 in demo); week strip + two `color-mix` explore
  tiles (gems / full chart). `.home-ambient` = quieter landing wash. Empty
  states split (spec item 1 amended): no list → picks + browse/import CTAs;
  quiet night → the viewer's own next-up week (verified live: DIGIMON
  "Sat · Ep 38 · in 2d 22h"). **Lint rules shaped the code:** react-hooks
  purity bars `Date.now()`/`new Date()` in render (allowed in lazy
  initializers/memos — `aired` is computed in the island's memo and passed
  down) and `set-state-in-effect` killed the mounted-gate — `Greeting` uses
  a `useSyncExternalStore` hydration gate instead. **JSX gotcha:** a space
  before an em dash after an expression gets eaten (`{user…} — text` →
  "sam— text"); explicit `{" — "}` string fixed it. Tests: **144** vitest /
  20 files (+20: 10 lib, 6 your-evening incl. all four island states, 4
  continue-watching incl. +1 payload + caught-up null), `task lint` clean.
  **Verified live** at 375/812 + 1440/900 as sakuga_sam on this session's
  own preview (previous session's `next dev` held the Next-16 workdir
  lockfile — killed per M2.4 precedent; `.claude/launch.json` recreated,
  autoPort): spotlight + rail (via a 2-row SQL scaffold on sam's list —
  **deleted after**), +1 on Frieren 8→9 live then reverted by SQL — **a
  progress upsert writes an `activities` row** (`type=progress`), deleted
  (id > 689) so Trending stays clean, DB byte-identical to seeded state;
  rooms rotation sampled (advances @5 s), quiet-night state, 0 console
  errors (spotlight cover got `priority` — it's the LCP), no h-overflow,
  44 px targets, section order sane on mobile. **Next (M3.3):** onboarding
  (post-register pick-your-shows + import CTA) + `/threads` hub + nav
  updates; the ledger row for M3.2 flipped to (F) — the design went
  pattern-setting (tint system, spotlight) rather than pure execution.
  · Live panel: quotes → rooms. **The problem:** the hero ticker quoted raw
  comment bodies — an unmoderated hot take as the site's first impression.
  **The call:** show the *fact* of conversation, never its content. New
  `buildRooms`/`LiveRoom` (`lib/landing.ts`) maps trending threads straight
  to room cards — cover, title, "Ep 10 room · 12 comments · 3 in there",
  mono `last_activity` ago — replacing `buildTicker`/`LiveTicker` (deleted;
  `app/live-rooms.tsx` ports the rotation window/pause/reduced-motion
  logic). This is scale-independent (a reaction/verified gate starves at
  exactly the low user counts where the landing matters; idea parked with
  that caveat), kills the landing's per-thread comment fetches entirely
  (trending payload already carries every stat), and nothing user-authored
  renders on the landing anymore — the spoiler-filter worry died with it.
  Dead rooms (0 comments, 0 presence) are dropped; lurker-only rooms rank
  (presence counts as life, matching M2.3's trending). **Bigger discussion
  presence:** panel column 26→30 rem, rows grew cover art + p-3, VISIBLE
  3→4 (4th slot `max-lg:[&>li:nth-child(n+4)]:hidden` keeps the stacked
  mobile hero lean), header "Live on Cour" at text-base. **Slower arrivals:**
  new `room-slide-in` (globals.css) — 480 ms, translateY(14px) +
  scale(0.97), overshoot bezier (0.34,1.3,0.64,1) — iMessage-ish settle vs
  the thread pages' 220 ms; rotation 4→5 s; reduced-motion drops it. Season
  chip got a glass pill (was unreadable over busy wall art). Cleanup:
  `hueFor` export reverted, unused `ThreadComment` alias removed. Tests
  swapped 1:1, still **124** vitest (buildRooms: mapping/order/no-speech +
  dead-room-unless-present; LiveRooms: stats-render, 5 s rotation, fits/
  reduced-motion/hover stills); lint clean. Verified live 375/1440 on the
  autoPort preview (**:3000 is the compose web container again — its image
  predates all of M3.1**, rebuild before demoing prod): rotation sampled,
  3-of-4 rows on mobile, 0 console errors, no h-overflow. **Next (M3.2)**
  unchanged — note "Tonight on Cour"'s *Live now* rail (§M3 item 2) can
  reuse `buildRooms`/`LiveRooms` nearly as-is.
- 2026-07-08 · M3.1 follow-up 2 (out-of-band, Miguel's design pass on the
  wall) · Landing layout + motion continuity. **Hero:** on `lg` the copy
  takes the left column and the live ticker rides the right as a glass panel
  (`bg-background/60 backdrop-blur`, "Right now on Cour" header + Jump in) —
  the conversation is part of the front door; on mobile it stacks inside the
  hero, so the standalone live-proof section is gone. Copy vertically
  centered (`lg:min-h-[36rem] items-center`). **Wall dissolves via masks now**
  (`hero-wall-mask`: bottom/side melts + a copy-hole that shifts left on lg,
  `mask-composite: intersect`) instead of painted washes — no color seams to
  sync. **Blank-gap bug fixed:** the −50% loop is only seamless while one
  track half outruns the viewport; each half now repeats its row ×3
  (`REPS=3`, half ≈ 4.8k px — long dwellers never see the tail drift into
  blank space). **Ambience:** `.landing-ambient` (globals.css) — a violet
  wash (color-mix over theme vars) holds through the hero and hands off to
  three faint off-axis radial glows down the page; the scroll never lands on
  one flat color. **Busiest threads:** trailing items hide at widths where
  they'd orphan a row (`sm:max-lg:hidden`/`lg:hidden` per index off
  `n − n%cols`, guarded ≥ one full row — 5 threads → 4 at sm, 3 at lg).
  **Seasonal grid → drifting rail:** new `SeasonalCarousel`
  (`app/seasonal-carousel.tsx`) reuses full `AnimeCard`s (score badge, airing
  chip) in one slow row (180 s) on the shared `.landing-marquee` primitive
  (renamed from `hero-marquee`; hover **and focus-within** pause since cards
  are links); only the first copy is interactive — loop filler is
  `inert` + `aria-hidden` + `motion-reduce:hidden`, and reduced motion turns
  the whole rail into a plain scrollable strip (`motion-reduce:overflow-x-auto`).
  **Gotcha (now 3×): Turbopack stale CSS** — globals.css edits (keyframes,
  masks, ambient) served stale even mid-session; `rm -rf web/.next` +
  restart, verify via `document.styleSheets`. **New min-width:auto bite:** the
  hero grid's single mobile track ballooned to 448 px (the ticker's nowrap
  truncate line sets the item's min-content; `max-w-md` capped it) clipping
  the copy at 375 — `min-w-0` on **both** grid items; that's the third
  truncate-in-grid incident, treat `min-w-0` as mandatory on any grid/flex
  item containing `truncate`. Tests: **124** vitest (+3: carousel
  inert/filler contract, null-without-covers, shared-track; wall test counts
  updated for REPS). Verified live 375/1440: copy no longer clipped, rail +
  wall drift (transforms sampled), busiest 3-of-5 at lg, halves 4757/2912 px,
  0 console errors, no h-overflow. **Next (M3.2)** unchanged.
- 2026-07-08 · M3.1 follow-up (out-of-band, Miguel's ask post-review) · Hero
  poster wall + ambient backdrop. **The eye-catcher:** two rows of anime
  covers drift slowly behind the hero copy (tilted −4°, counter-directions,
  110 s/150 s so they never lockstep), CSS-only via new `hero-marquee`
  keyframes in `globals.css` (track holds the row twice, translates −50% for
  a seamless loop; static under `prefers-reduced-motion` — the covers still
  catch the eye, they just hold still). **Sourcing honors the thesis:** no
  hall-of-fame endpoint — new `heroCovers` in `lib/landing.ts` mines a
  40-deep `GET /trending` pool for *both* trending rank and the biggest
  all-time-popularity titles inside it (that's where AoT/Death Note/One
  Piece surface for newcomers to latch onto; confirmed live against the demo
  DB), seasonal fills the remainder; cap 18, coverless dropped, and a
  **word-boundary franchise dedupe** ("Attack on Titan Season 2" skipped
  after "Attack on Titan", but "Title 10" is *not* a sequel of "Title 1" —
  the naive startsWith was a real bug the test caught). **Backdrop:** hero
  went full-bleed (own section outside PageShell), two blurred `bg-primary`
  glow blobs + the wall's three-layer text protection (light flat dim,
  vertical edge melt, radial scrim focused behind the copy) — first overlay
  attempt drowned the art, the radial rework keeps covers recognizable at
  the edges, which is the whole point. `HeroPosterWall`
  (`app/hero-poster-wall.tsx`) is decorative: `aria-hidden`,
  `pointer-events-none`, no links, `alt=""`, renders `null` under 8 covers.
  Tests: **+6 vitest** (3 `heroCovers` incl. the boundary case, 3 wall:
  min-covers null, doubled rows/decorative contract, coverless filter;
  next/image mocked) = **121** across 17 files; lint/tsc clean. **Verified
  live** at 375/desktop: marquee transform sampled moving, both rows
  animated (110 s normal / 150 s reverse), 36 imgs, no h-overflow, 0 console
  errors. **Gotcha (M2.4 repeat):** Turbopack served `globals.css` *without*
  the new keyframes — `.hero-marquee` computed `animation: none` — fixed
  again with `rm -rf web/.next` + restart; check served CSS via
  `document.styleSheets` before distrusting an edit. **Next (M3.2)**
  unchanged.
- 2026-07-08 · M3.1 · Landing + routing. **Plan amendment (spec §M3 Routing
  edited in place):** the spec'd `cookies().has("cour_refresh")` branch can't
  work — the refresh cookie is scoped to `Path=/api/v1/auth` and never rides
  page requests. The API now sets a **token-free `cour_session=1` marker at
  `Path=/`** in `setRefreshCookie` and clears it in `clearRefreshCookie`
  (auth.go; same expiry/Secure/SameSite, HttpOnly — it grants nothing, it's
  routing signal only), so login/refresh set it and logout *and* the
  refresh-rejection path clear it (the heuristic self-heals). New integration
  `TestSessionMarkerCookie` asserts via the cookie jar that page-scoped
  requests carry the marker but never the refresh token, and logout clears it.
  No openapi change (cookies aren't spec'd) → no `task gen`. **Routing:**
  `app/page.tsx` awaits `cookies()` (async in Next 16; makes `/` dynamic —
  accepted, all fetches underneath are revalidate-cached) and branches:
  marker → `HomeView` (the old page body extracted verbatim to
  `app/home-view.tsx`; M3.2 rebuilds it), else → `LandingView`. Page-level
  SEO metadata: `title: {absolute}` (dodges the layout's `%s · Cour`
  template), description, openGraph type website + siteName, twitter summary.
  **Landing (`app/landing-view.tsx`):** hero (season chip "Summer 2026 · N
  shows airing", "Watch the season together." verbatim, sub per spec, Join
  Cour → /register + "Peek at tonight's threads" → top trending thread, falls
  back to /schedule; both CTAs 44 px on mobile) · **live-proof ticker**
  (`app/live-ticker.tsx` client component over `GET /threads/trending?limit=6`
  + the newest 10 comments of the top-3 chattering threads, all
  `revalidate: 60`; pure `buildTicker` in new `lib/landing.ts` flattens/sorts/
  caps 8 and **drops spoiler-marked + deleted comments** — visitors never see
  either; rotates a 3-row window every 4 s reusing the thread pages'
  `comment-enter` slide-in, keyed so surviving rows never re-animate; pauses
  on hover, stops under `prefers-reduced-motion` or when ≤ 3 items; avatar
  identity via exported `hueFor`) · tonight strip (`tonightEntries`: next 24 h
  + 1 h just-aired grace; falls back to "Airing next" when empty) · busiest
  threads (cover/title/"Ep N thread · X comments · Y in there now", grid) ·
  seasonal preview (12, `priorityCount=0`, below fold) · no-streams promise
  **verbatim** + AniList attribution card. `threadHref`: episode → episode
  page, series → `/anime/{id}/discussion`. **375 gotcha:** grid items'
  `min-width:auto` + the nowrap `truncate` title made busiest cards overflow
  the track (2 px doc h-scroll) — `min-w-0` on the `li` fixed it; remember for
  any grid of truncating cards. Tests: **+13 vitest** (`lib/landing.test.ts`
  8: href/ticker filter+sort+cap/tonight window/ago labels;
  `app/live-ticker.test.tsx` 5: links, fake-timer rotation, fits-no-rotate,
  reduced-motion still, hover pause) = **115** across 15 files; go unit +
  **full integration suite** green; `task lint` clean. **Verified live**
  (Docker api rebuilt — compose image predates the marker cookie — + native
  `next dev` preview): anon `/` renders all landing sections with real demo
  data, ticker rotates 4 s cadence (sampled), 0 console errors, no h-overflow
  at 375, desktop 1440 = centered 768 px ticker + 3-col busiest; login as
  sakuga_sam → `/` flips to HomeView (curl confirmed both Set-Cookies), logout
  → landing. **Preview gotcha:** react-hook-form ignores `preview_fill` on the
  login form (no POST fired) — drive auth via `fetch` from `preview_eval`
  instead. **Next (M3.2):** "Tonight on Cour" — rebuild `home-view.tsx`
  per §M3 (your evening / live now / continue watching / season's
  conversation + **"Back in the conversation"** sub-row from trending where
  season ≠ current); the landing's threadHref/ticker/tonight helpers in
  `lib/landing.ts` are reusable there.
- 2026-07-08 · M2.6 · Thread comment pagination — the whole change was already
  sitting uncommitted from an interrupted prior session; this session
  **reviewed, ran, verified live, and committed it**. **Spec-first backend:**
  `openapi.yaml` `listComments` gains `before_id`/`limit` params and `CommentList`
  gains a nullable `next_cursor`; `task gen` was already in sync (no drift).
  `ListComments` query flipped to a newest-first keyset page
  (`WHERE thread_id=@thread_id AND id < @before_id ORDER BY id DESC LIMIT @page_limit`,
  served by the existing `comments (thread_id, id)` index); the service fetches
  `limit+1` to detect a further page without a count query and returns the page's
  oldest id as `next_cursor` (nil at the end). Handler: `before_id` defaults to
  `math.MaxInt64` (newest page), `limit` default 50 / max 100. **Client:**
  `ThreadView` swapped `useQuery`→`useInfiniteQuery` (pageParam 0 = newest;
  `getNextPageParam` = `next_cursor`); pages arrive newest-first and are
  flattened+**reversed** to arrival order (id ASC) so the reply-tree builder
  always meets a parent before its children. The SSE cache-merge helpers were
  lifted over the paginated `InfiniteData` shape: `applyCreated`→`mergeCreated`
  (prepend to page 0, idempotent replace-in-place across pages), plus
  `mergeDeleted`/`mergeReaction` via a `mapPages` that preserves untouched page
  references. **Two interplay decisions (spec asked to decide + note):**
  (1) **orphan replies** — a reply whose parent sits on an unloaded older page
  is promoted to a *display root* (instead of silently vanishing) and marked with
  a dashed "↩ earlier comment" stub in `comment-item.tsx`; once "Load older"
  pulls the parent's page in, it re-nests and the stub clears — verified live.
  (2) **Top/Timeline over the loaded set** — chose "rank what's loaded" + an
  honest scope note ("Showing the N most recent comments — every sort covers just
  these") shown whenever `hasNextPage`, rather than fetch-all-under-a-cap. "Load
  older" button is the app-standard 44 px touch target (`h-11 md:h-8`). **Tests:**
  reworked `use-thread-events.test.ts` (paged-cache `mergeCreated`/`mergeDeleted`/
  `mergeReaction` cases incl. reference-preservation + no-op-before-load) and
  `thread-view.test.tsx` (existing fixtures flipped to newest-first; +2: Load-older
  keyset paging, orphan-stays-visible-with-stub); new integration
  `TestCommentPagination` walks a 5-comment thread at limit=2 through the cursor
  and asserts the pages tile it exactly once (no gaps/dupes/truncation).
  **All green:** go unit + integration, web **102** vitest / 13 files, `task lint`
  (golangci 0 / eslint / tsc) + `task gen` clean. **Verified live** at 375/desktop
  as anon on a seeded 60-comment thread (anime 16 ep 2, thread 210): default page
  = 50 newest with the scope note + Load-older; the orphan reply (parent on the
  older page) showed the stub; clicking Load older folded in the last 10, cleared
  the note/button/stub, re-nested the reply; 0 console errors, no h-overflow at
  375, 44 px button. **Ops:** rebuilt the compose **api** image (it predated the
  pagination endpoint — old build ignored `limit` and had no `next_cursor`); the
  60 test comments were seeded by direct SQL (comment POST is rate-limited ~50/burst
  — note for future bulk seeding) and **deleted after**, along with 55 stray
  `activities` rows left by an initial API-post attempt before I switched to SQL
  (comment posts write a `comment` activity → would poison Trending; demo DB back
  to seeded state, empty thread-210 shell left as harmless). Comments are read
  live from PG (no Redis cache to bust, unlike `anime:v1:{id}`). **Next (M3.1):**
  landing + routing — `cour_refresh` cookie branch in `app/page.tsx`, hero,
  live-proof ticker, tonight strip, seasonal preview, SEO. M2 is now complete;
  M3 wires the trending/velocity signals M2.3 built into the home + landing.
- 2026-07-08 · M2.5 · Episode list pagination. All client-side over the
  detail payload's full episode array — no API/schema change, no `task gen`.
  New pure helper `web/lib/episodes.ts` (unit-tested, mirrors `lib/seasonal.ts`):
  `needsPagination` (> 50 eps), `buildRanges` (fixed episode-number buckets of
  50, **only non-empty buckets**, newest-range-first, **full-span labels even on
  a partial top bucket** — "1051–1100"), `orderEpisodes` (asc/desc, non-mutating),
  and `latestAiredEpisode` (most-recent **past** `airing_at`; falls back to the
  highest number when nothing has aired or dates are unknown; null only for an
  empty list). `episode-list.tsx` is now a **client** component: ≤ 50 eps render
  **exactly as before** (plain ascending `<ol>`, zero chrome — the shared
  `EpisodeGrid`); > 50 gets a Newest/Oldest order toggle (default **Newest**) +
  range chips (newest active), reusing the seasonal `Chip` (`Button size="sm"`,
  `aria-pressed`). Ranges bucket by **episode number** (how people think about long
  shows), not array position. **"Latest episode"** link added to the detail action
  bar next to Discussion (`page.tsx`, server-side via `latestAiredEpisode` — safe:
  `Date.now()` at request time, not in a client render) → `/anime/{id}/episode/{n}`.
  Decisions: **URL-sync deferred** (spec's "optional") — kept local `useState` so
  the change stays contained to the component (no Suspense boundary on the whole
  detail page, unlike M0.5's seasonal view); range/order live in component state.
  Chips are the app-standard 28 px `sm` scale (matches seasonal filters; the 44 px
  touch lift is still the deferred primitive-level Parking-lot task, inherited free
  when it lands). Tests: **+13 vitest** (`lib/episodes.test.ts`: threshold, bucket
  math incl. sparse numbering / ep-0 fold / partial-top labels, order non-mutation,
  latest-aired past-wins / no-aired-fallback / unknown-dates / mixed) = **109**
  across 13 files; `task lint` (golangci 0 / eslint / tsc) clean. **Verified live**
  at 375/desktop as sakuga_sam: seeded One Piece (anime 170) with 1169 weekly-spaced
  eps in the demo DB → 24 range chips newest-first (1151–1200 … 1–50), default
  Newest range showing 1169→1151, order toggle flips to 1151→1169, "1–50" chip
  isolates eps 1–50, "Latest episode" → **ep 1168** (1169 airs in 4d, correctly
  excluded); Shingeki (25 eps) renders with **no** chrome, "Latest episode" → ep 25;
  no h-overflow at 375, 0 console errors. **Ops:** the seeded One Piece eps were a
  test scaffold — deleted after (only the original ep 1169 remains) and the Redis
  `anime:v1:170` cache busted, so the demo DB is back to its seeded state
  (`Detail` is Redis-cached under `anime:v1:{id}` — bust it after any direct
  `episodes` write). No compose image rebuild needed (web-only change; runs on the
  native `next dev` preview). **Next (M2.6):** thread comment pagination past the
  silent `LIMIT 500` — cursor `before_id`/`after_id`, "load older" tail, and the
  reply-tree orphan caveat (parent on an unloaded older page); this one **is**
  spec-first (openapi.yaml + `task gen`).
- 2026-07-08 · M2.4 · Typography split. **Geist** (was already loaded via
  next/font but unused) is now the body/prose/heading face; JetBrains Mono
  stays on `--font-mono` and is re-anchored *explicitly* where data lives.
  Core flip is exactly the spec's two files: `globals.css` (`html { @apply
  font-sans }`, `--font-heading: var(--font-sans)`) + `layout.tsx` (html
  loses the `font-mono` class; unused `Geist_Mono` import dropped). Then
  `font-mono` added at the data call sites: anime-card score badge / airing
  chip / meta line; schedule strip + days (sticky day header, time column,
  ep·countdown lines); episode-list "Ep N" + air dates; comment `<time>` +
  "you" badge (timestamp + night-of chips were already mono); thread
  presence count; episode-page airing line; detail-page score badge /
  next-airing countdown / meta stat line ("TV · 28 episodes · …"); my-list
  row meta + progress and the list-editor trigger ("Watching · 8/28");
  profile stat values / genre counts / Ep overlay; recs meta; seasonal "N
  titles"; trending recompute line; feed + notification timestamps; bell
  unread badge; and the header wordmark — **"Cour" stays mono, it's the
  brand**. Removed the now-dead `font-sans` opt-outs (comment/review/
  synopsis/bio bodies, both composer Textareas). Decisions: @handles stay
  sans (mono handles inline with sans prose read noisy — spec's "if it
  reads well" said no); import/settings screens stay sans (prose sentences
  with embedded numbers, not data chips). Verified in preview at
  375/desktop as sakuga_sam (home, seasonal, schedule, detail, Frieren
  ep-10 thread incl. spoiler-shield banner, list, profile): faces split
  correctly per computed styles, no h-overflow at 375, 0 console errors.
  Tests: 83 vitest + go unit, `task lint` (golangci 0/eslint/tsc) clean —
  no test changes needed (nothing asserts fonts). **Env gotchas:** Next 16
  refuses two dev servers in one workdir (`.next/dev` lockfile) — a
  leftover `next dev` from an earlier session held it and had to be killed
  before `preview_start`; and Turbopack's **persistent dev cache served the
  pre-edit `globals.css`** even across that restart (layout.tsx recompiled,
  the CSS chunk didn't) — one-time `rm -rf web/.next` fixed it; check
  served CSS before distrusting an edit. **Next (M2.5):** episode list
  pagination — newest-first default + asc/desc toggle, range chips of 50,
  "Latest episode" jump in the detail action bar; One Piece scale is the
  acceptance test.
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

- **M3.8 follow-ups (2026-09-04):** badge-earned toast at the moment of
  earning (needs a client-side diff of `/me/pulse` badges between visits,
  or a server-side `earned_at`); the schedule's Popular lens could rank by
  trending score rather than raw popularity once the worker exposes it;
  `episode_aired` notifications already exist — a "tonight" push/digest
  would close the come-back loop from outside the site.

- **The owner's own profile edits look like they vanish for 60 s** (found
  2026-07-09 while verifying M3.6). `users/[username]/page.tsx` fetches the
  profile with `next: { revalidate: 60 }`, so after saving a bio/accent/banner
  the client state shows the truth, but navigating away and back re-renders
  from Next's *fetch* cache and shows the old value until it expires. The API
  side is already correct — `Service.Update` deletes the Redis profile key, and
  a direct `GET /users/{u}` returns the new value immediately. Pre-existing
  since M3.5 (the banner picker has the same wart); M3.6's edit-in-place bio and
  accent just make it obvious. Fix is a tagged fetch (`next: { tags: ["profile",
  username] }`) plus a server action calling `revalidateTag` after a successful
  `PATCH /me/profile` — needs a read of the Next 16 caching guide in
  `web/node_modules/next/dist/docs/` first, since this is exactly the area that
  differs from training data. Also worth deciding whether an owner viewing their
  own profile should bypass the cache entirely. Same staleness makes a
  just-added favorite miss the accent-swatch row and the banner picker for a
  minute — `PUT /me/favorites/{id}` does not bust the profile cache either.

- **Comment snippets on the landing, behind a quality gate** (from the
  2026-07-08 landing sessions) — the landing briefly quoted real comment
  bodies and was reworked to activity-only "live rooms": an unmoderated hot
  take must not be the site's first impression. If real traffic ever makes a
  curated feel-of-the-conversation feed worth it, gate it hard (reaction
  threshold, account age/verified tier, mod allowlist — Miguel floated all
  three) and note every gate starves at low user counts, which is exactly
  when the landing matters most. Rooms may simply stay the right answer.

- **Episode titles in the list** (from a 2026-07-08 M2.5 follow-up ask) —
  the UI already renders them (`episode-list.tsx` `{e.title && …}`, and the
  API `Episode` schema carries `title`), but **no episode row has one**: the
  sync only writes numbers (`EnsureEpisodes`) + air times (`upsertEpisodeAiring`
  from AniList `airingSchedule`, which has no title). AniList's only source is
  `Media.streamingEpisodes { title }` ("Episode 1 - Romance Dawn"). So this is a
  backend sync feature, not a UI tweak: add the field (a *targeted* enrichment,
  **not** the shared `mediaFields` fragment — it'd bloat the whole 22k crawl),
  parse the "Episode N – …" prefix to map titles to numbers (fiddly: varied
  formats, non-1..N ordering), `UpsertEpisode` the titles, backfill re-crawl
  (hours, like M1.1). Two caveats decided the park: (1) **no-streams policy** —
  title *text only* (drop url/thumbnail/site) doesn't host/proxy/link video, so
  defensible, but it's a line to bless; (2) **titles are classic spoilers** — the
  list shows future/unwatched eps, so titles for those should ride M2.3's
  progress-aware spoiler shield or they undercut it. Coverage would be partial
  (streamingEpisodes is spotty for older/niche shows). Miguel parked it 2026-07-08.

- **Palette / brand pass** — _resolved 2026-09-04 by M3.7 (teal + ink, see
  §M3.7)._ Original note (from the 2026-07-07 review): the
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

- **Trending tie-break is nondeterministic** (spotted 2026-07-09 while
  M3.5's integration run flaked once) — `TestMALImportZeroActivity`
  failed on two near-equal decayed scores swapping rank between the
  before/after recomputes (`[…, 9, 14]` → `[…, 14, 9]`), then passed on
  rerun; nothing in M3.5 touches activities or scoring. Root cause: the
  trending rankings (anime `discovery` and thread `trending.go`) order by
  float score with no stable tie-break, and exponential decay means two
  close scores can cross between any two recomputes. One-line fix when it
  next itches: `ORDER BY score DESC, id` (and the same in the test's
  expected ordering). Product impact is a cosmetic rank jitter for tied
  titles; the test flake is the real cost.

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

*(Amended in M3.1.)* The original plan — branch on
`cookies().has("cour_refresh")` — can't work: the refresh cookie is
deliberately scoped to `Path=/api/v1/auth`
([`backend/internal/httpapi/auth.go`](../backend/internal/httpapi/auth.go)),
so page requests never carry it. Instead the API sets a **token-free marker
cookie `cour_session=1` at `Path=/`** alongside the refresh cookie (same
lifetime, cleared together — including by the refresh endpoint when it
rejects a dead session), and `app/page.tsx` branches server-side on that.
Presence of the marker ≈ signed in. It's still a heuristic (a stale marker
renders the authed shell whose islands resolve to anon); acceptable.
Caching reality (Next 16): reading `cookies()` makes `/` dynamic-rendered,
not static — but every fetch underneath is revalidate-cached (60 s for the
live-proof data, 300 s catalog default), so the per-request render is
cheap and the landing still "visibly moves" on a ~60 s cadence.

### Logged-in home — "Tonight on Cour"

Server shell + client islands, top to bottom:

1. **Your evening** — episodes airing in the next 24 h from the viewer's
   *watching* list, each with countdown and thread link + live count
   ("ep 9 thread · 14 in there"). Composable client-side from the existing
   `/schedule` + list data. *(Amended in M3.2:)* the soonest episode gets a
   cover-color **spotlight card** (live countdown, room presence, one CTA);
   empty states split — no list at all → seasonal picks + pick/import CTAs,
   list-but-quiet-night → the viewer's *own* next-up episodes from the
   7-day schedule (truer to "your evening" than generic picks).
   *(Amended in the M3.2 follow-up, Miguel's asks:)* on `lg`+ tonight also
   renders as a **physical timeline** — a 25 h axis (1 h just-aired grace +
   24 h ahead) with a half-hour tick grid, a pulsing now-line, and cover
   thumbnails pinned at exact air times (collisions stack into lanes);
   hover/focus opens a preview card (airing facts, genres, room presence,
   synopsis lazy-fetched from `/anime/{id}` once per show) and click enters
   the thread. Under `lg` the rail cards carry tonight instead — hover
   previews don't translate to touch. And the quiet night is never empty:
   below the week-ahead rail, a **recommendations rail**
   (`/me/recommendations`, cache shared with the For-you page, seasonal
   fallback until the recommender has signal).
2. **Live now** — busiest threads (M2 velocity + presence). *(Amended in
   M3.2:)* rooms, never comment snippets — the M3.1 editorial-safety rule
   (show the fact of conversation, not its content) applies to every
   assembled surface; reuses the landing's `buildRooms`/`LiveRooms` panel
   verbatim.
3. **Continue watching** — next unwatched episode per show, inline `+1`,
   "discuss ep N" link.
4. **The season's conversation** — existing trending, reframed with
   discussion stats ("312 comments this week"). Companion sub-row:
   **"Back in the conversation"** — titles in the trending top-N whose
   season ≠ current (the TikTok-revived 2013 show). Trending Now is
   already all-catalog (AoT/MHA rank today), so this is a filter + label,
   nearly free — it tells the viral-revival story explicitly instead of
   silently mixing old shows into the grid. An all-time "popular" tab was
   considered and **rejected as front-door content**: MAL/AniList own the
   hall-of-fame list; recency is the differentiation. *(Amended in the M3.3
   follow-up:)* the rejection stands for the home/landing surfaces, but an
   all-time-popular list **is** allowed as a scoped onboarding aid — the
   `/welcome` picker's "All-time popular" tab (`GET /anime` sans `q`, which
   browses by popularity) plus free search let a returning fan who isn't
   watching the current season still seed a list and find older shows'
   threads. It's a list-seeding tool, never assembled front-door content, so
   the thesis holds where it matters.
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
  *(Built: axis spans 0:00→last stamp — episode runtime isn't in the
  thread payload, so the discussion's own extent is the honest axis;
  bars are decorative, transparent cluster-region buttons carry the
  semantics and the touch targets.)*
- **Empty state** — replace "No comments yet — first!" with something
  alive: airing countdown for upcoming episodes, presence count when
  anyone's in the room, a be-first nudge. Dead air is the enemy.
- **Live-window header** — within ~24 h of `airing_at`, the thread header
  gets a LIVE badge + M2.3's velocity ("N/min"). The M2.3 stretch
  night-of badge marks *comments* in the permanent record; this marks
  the *room* while the ritual is happening. *(Built as a split: the LIVE
  pill renders SSR in the page header next to the airing line; velocity —
  computed client-side from the loaded comments, no new endpoint — sits
  in the thread vitals row beside presence, where the live data lives.)*

### Profile revamp (M3.5)

*(Spec'd 2026-07-08 from Miguel's ask: "pretty to look at, with colors,
profile descriptions, banners, interactive statistics, and some way to
quickly look through completed/dropped/etc.")*

**Diagnosis.** The profile is a stat sheet, not a page about a person:
flat header, five gray boxes, static genre bars. It's also the page people
will paste into a Discord bio — it should be a *poster of your taste*,
the way the landing is a poster of the product. Apply the landing/home
playbook: art-backed hero, data-driven color, motion that means something.

**Design, top to bottom:**

1. **Banner hero.** Full-bleed banner behind the identity header, chosen
   from the owner's favorites' AniList banner art — no uploads (no storage
   or moderation surface; parity with URL-based avatars). Own-profile gets
   a "choose banner" popover listing favorites that have `banner_image`.
   Text protection via the hero-wall mask pattern, not painted washes.
   **Fallback keeps fresh profiles dressed:** no banner picked (or none
   available) → a static masked poster-wall strip from favorites/watching
   covers; zero-list accounts get the ambient violet.
2. **Accent color.** `--tint` derives from the banner anime's
   `cover_color` (else top favorite) and washes the page the way home's
   spotlight does: avatar ring, stat numbers, section headings, tab
   underline — all `color-mix` over theme vars, readable in both themes.
   Every profile is colored by its owner's taste, not by our palette.
3. **Identity block.** Avatar over the banner edge, @handle + role badge,
   **bio elevated** to a real position (readable measure, whitespace
   preserved — the field already exists), member-since, follow button,
   follower/following counts (RelationState exists), favorite-genre chips.
4. **Interactive statistics** (client islands; hover = detail, click =
   action):
   - **Score histogram** — 1–10 bars; hover a bar for count + share;
     click filters the library tab to that score. Bars animate in once
     (reduced-motion: static).
   - **Watch time** — "≈ 9d 4h in front of the screen", one big mono
     number (Σ progress × duration).
   - **Genre bars** — keep, tint them, make each a filter link into the
     library tab.
   - *Stretch:* seasonal spread — completed shows bucketed by
     `season_year`, a mini strip that shows "your 2019 era" at a glance.
5. **Library tabs** — the quick-browse ask. The five status counts become
   real tabs on the profile (Watching · Completed · Planning · Paused ·
   Dropped, counts in the label) opening a dense poster wall with
   score/recency/title sort and pagination. Own profile adds a "manage on
   My list →" shortcut; editing stays on /list.
6. **Currently-watching rail** stays (it's good), gains progress bars and
   the tint treatment.

**API/schema deltas (spec-first, all small; as-built amendments in place):**

- `users.banner_anime_id bigint NULL REFERENCES anime ON DELETE SET NULL`
  migration (000016); **`PATCH /me/profile`** (the endpoint was always
  PATCH, not PUT) accepts `banner_anime_id` with the score-field
  convention — **0 clears, omitted keeps** (oapi-codegen pointers can't
  tell JSON null from absent); unknown anime → 422. `UserProfile` returns
  a resolved `banner: { anime_id, banner_image, cover_color } | null`.
  Profile cache key bumped `profile:v1` → `v2` (shape change).
- `ProfileStats` grows `score_histogram: [{score, count}]` (all ten
  buckets, zero-filled server-side) and `watch_minutes` (one GROUP BY +
  one SUM in the stats query); stretch `season_counts` **deferred** —
  session was already the biggest M3 build.
- New `GET /users/{username}/list?status=&score=&genre=&sort=&page=&per_page=`
  — public, paginated (50), reuses the list-entry mapper; `total` rides
  along via `COUNT(*) OVER()`. **`score` + `genre` params added beyond the
  original sketch**: the histogram/genre-bar clicks filter server-side, so
  the tabs stay honest across pages instead of filtering loaded rows.
  Lists are public by default (MAL/AniList convention); a privacy toggle
  is parked.
- **Banner candidates need no endpoint**: `AnimeSummary` doesn't carry
  `banner_image`, so the own-profile picker lazily fetches `/anime/{id}`
  per favorite on first open (`["anime-preview", id]`, staleTime ∞ —
  the M3.2 preview-cache pattern).
- **UI decision:** the library gets an **All tab** ahead of the five
  status tabs; a histogram/genre click lands there (an exact-score filter
  cuts across statuses — landing on a narrower tab would silently drop
  matches) with the filter as a removable chip.

**Acceptance.** sakuga_sam's profile at 375/1440: banner + tint applied,
histogram hover/click filters the library tab, all five tabs page through
real entries, anon view = same page minus edit affordances, a fresh
zero-list profile still looks dressed. Stats queries unit-tested,
histogram/tabs vitest-covered, `task gen` clean (spec changes), no
h-overflow at 375, 44 px targets, reduced-motion drops the count-up/bar
animations.

### Profile personality (M3.6)

*(From Miguel's 2026-07-09 ask: the hero's purple patch never lines up with
the headline; the profile's default banner "looks crooked"; favoriting is
hard to find; stats are fun and there should be more of them; more movement;
and since profiles will be public, real personalization — bio, accents.)*

**Two alignment bugs, one root cause.** The landing hero's violet bloom was
pinned `left-1/2` — viewport center — while the copy moves to the left column
at `lg`. The poster wall's mask already opened its readability hole at `30%`
to follow the copy, but 30% is only correct near 1440px (it is 74px off at
1024, 105px off at 1920).

**The trap:** anchoring to the copy *column* is not enough. Making the bloom a
child of the column tracks the column's center, but at `lg` the column is
832px while the headline's glyphs span only ~470 of it — the `h1` is
`max-w-3xl` (768px) and `text-wrap: balance` never fills it. Measured at 1440:
the glyphs centre on **259**, the column on **441**. So a column-centred bloom
still sits ~180px right of the words, which is exactly what it looked like.

The right anchor is the headline's half-width, `15rem`, measured from the
column's **left edge**, with a `50%` floor for columns too narrow to hold it:
`left: min(15rem, 50%)`. From the section's side — where the wall's mask lives
— the same point is `max(calc(50% - 28rem), 16rem)`: the column's left edge is
`50% - 43rem` once `max-w-[88rem]` binds (half the shell, less the `30rem`
panel and the `4rem` gap, plus the `1rem` gutter), and `-43rem + 15rem =
-28rem`; below that the shell stops binding, the gutter pins the column at
`1rem`, and the anchor settles at a constant `16rem`. The two expressions
agree to the pixel for every width ≥ 1056px, and diverge by ≤16px below it,
where the bloom is already wider than the column. The wall takes a
`splitLayout` prop, because only the caller knows whether the live panel
claimed the right column — a roomless hero centres its copy and its hole.

> **Superseded later the same day** (Session log: hero readability refactor):
> the mask hole and `splitLayout` are gone entirely — readability rides on a
> copy-anchored `.hero-copy-backdrop` inside the isolated copy column, which
> binds to the text instead of chasing it from wall coordinates. The
> glyph-rect measurement lesson above still stands (it is how the backdrop's
> `--hero-copy-focus` bloom anchor was derived).

The profile's fallback poster wall simply loses its `-rotate-2`; covers now
crop to the band height instead of keeping a 2:3 box, because a banner is a
horizon.

**Favoriting.** The control was an unlabelled heart wedged between two
labelled buttons, and it existed on exactly one page. It now says *Favorite* /
*Favorited* and wears the accent when on. A second home: a switch in the
list-editor dialog, which applies on **Save** alongside the entry (its state
is `boolean | null`, where null = untouched — seeding a boolean at mount would
lie if the favorite query resolved after the dialog opened). Hearts stay off
`AnimeCard`: it is a server component, and one favorite query per grid cell is
not worth it. The profile's empty Favorites shelf tells the owner where the
heart lives *and* what it buys (banner + accent).

**Statistics.** All four groups Miguel picked, all derived from data already
stored — no new sync:

- **Taste fingerprint.** `score_bias` compares the owner's mean with AniList's
  over only the shows both scored (`average_score / 10` puts them on one
  scale); withheld below **5** shared shows, because a verdict from three is a
  coin flip. `score_stddev` (population) says how much of the 1-10 scale gets
  used; withheld below 2 ratings, where it is trivially 0. Genre bars gained a
  notch at the owner's mean for that genre, on a 1-10 axis rather than the
  count axis — suppressed below 3 ratings.
- **Eras & formats.** `season_counts` buckets *completed* shows by premiere
  year (a planning list is a wish, not a history); the strip zero-fills gap
  years client-side (`fillEraGaps`) or an 18-year hole reads as two adjacent
  bars. `format_counts` is one stacked bar, separated by opacity rather than
  hue so it never fights the owner's accent.
- **Habits.** Follow-through and drop rate share one denominator —
  completed + dropped + paused, the shows that *settled* — so they are
  comparable; planning never started and watching hasn't stopped. Top studio
  reads `studios` JSONB filtered to `is_main` (nobody's most-watched studio is
  Aniplex).
- **Milestones.** Longest completed series, shelf span, and a watch-time
  framing (percent of a year, feature-film equivalents).

Every one of these hides itself on a shelf that can't support it: a fresh
profile shows none of them rather than a wall of zeroes and dashes.

**Movement.** `CountUp` animates the headline numbers on first scroll into
view. It renders the *true* value through React and mutates `textContent`
imperatively from a layout effect, so SSR, no-JS, and reduced-motion readers
all get the real number with no hydration mismatch, and a re-render mid-flight
can only restore the truth. Target and formatter live in refs refreshed after
commit (writing refs during render is unsafe once rendering can be
interrupted, and `react-hooks/refs` rightly rejects it) — so the animation
runs once per mount, retargets rather than restarts, and an inline `format`
arrow can't re-zero a landed number. The bias needle swings out from the
crowd's midpoint; era columns rise; format segments sweep.

**Personalization.** Migration `000017` adds `users.accent_color TEXT` with a
**lowercase** `#rrggbb` CHECK — the service lowercases before writing, so the
constraint only ever fires on a bug, never on user input (uppercase in,
lowercase out; garbage is a 422, not a constraint-violation 500). `PATCH
/me/profile` takes it with the avatar convention (**empty string clears,
omitted keeps**). Swatches come from the owner's favorites' `cover_color`
first — every accent then belongs to a show they love — plus a short house
palette spread across the wheel for the case where every favorite is the same
muted teal. Hovering a swatch repaints the *live page*, not a 24px chip, since
the accent touches the avatar ring, every heading, and every bar. Everything
lands through the existing `color-mix` pipeline, so no pick can make either
theme unreadable. The bio is editable where it is read; Settings still owns
the field, but sending someone to /settings to write one sentence is how bios
stay empty. `profileTint` order is now **accent → banner → first favorite with
a color**.

**API/schema deltas.** `ProfileStats` grows `score_stddev`, `score_bias`,
`genres[].mean_score` + `rated_count`, `season_counts`, `format_counts`,
`top_studios`, `longest_completed` (an `AnimeSummary`), `library_span`; new
named schemas rather than inline objects, so oapi-codegen emits real Go types
instead of anonymous structs. `UserProfile` gains `accent_color`. The public
list gains `year` + `format` params so the era strip and format split filter
server-side like every other stat — an era click also narrows the tab to
**completed**, since that is all that chart ever counted. Profile cache key
bumped **v2 → v3** (shape change).

**Acceptance.** Both alignment fixes hold at 375/768/1024/1280/1440/1920 — the
bloom's centre is within ~5px of the headline's *glyph* centre at every width
where the bloom is narrower than the column, and dead-centre on the copy below
`lg`. Measure `range.selectNodeContents(h1).getBoundingClientRect()`, never the
`h1` box: the box is `max-w-3xl` and lies about where the words are. Favorite
round-trips from the detail button and the dialog switch. Stats match the
database. Accent previews on hover, persists on click, and clears. Bio saves
in place. A zero-list profile shows no stat sections at all. Reduced motion
leaves every number truthful and every bar still.

---

### Visual refresh (M3.7)

*(From Miguel's 2026-09-04 ask — landing first, then the signed-in home.
Deliberately out of the M4 order: a brand pass is cheap while the surfaces
are few, and the landing's job is to capture newcomers.)*

**Palette — teal + ink.** Violet was trend-adjacent (the Parking-lot note);
teal reads as "live" without the Linear-era look, and near-black surfaces
let cover art carry the color. All in `globals.css` tokens; nothing
page-level references a hue. The one place a second accent is needed
(multi-series charts) keeps violet as `--chart-2`.

**Shape.** `--radius` 0.75rem and no `rounded-none` primitives: buttons,
inputs and menus `md`/`lg`, cards and dialogs `xl`, badges and bars `full`.
Marketing CTAs (hero, closing band) are pills. Square corners survive only
where they are structural (borderless controls inside an input group, the
line-variant tab list, the tooltip arrow).

**Hero wall.** Backdrop, not poster grid: 55 % opacity, ~2× slower drift,
and 26 *distinct* covers repeated twice per row instead of 18 repeated
three times — the same face should not come round three times per screen.

**The tour.** Newcomers must see what "live threads" and "spoiler-safe by
your progress" mean without an account. Three self-running scenes, ~10 s
loops, no network: a room filling with comments and a presence badge; the
spoiler shield lifting as +1 walks progress from Ep 7 to Ep 9; tonight's
line-up with notification toasts landing. Rules: fixtures are invented
(no real member is ever quoted on the front door), nothing inside links
anywhere, reduced motion shows each scene's finished frame, loops idle
while the tab is hidden. Below it, three plain steps (bring your list →
watch, then +1 → talk in the room) and a closing CTA band that carries the
no-streams promise + AniList credit.

**Poster budget.** The landing still shows real art (tonight strip, busiest
threads, seasonal rail) — but each once: the seasonal marquee's four copies
became one snap-scrolling row of ten.

**Signed-in home.** Inherits the tokens; nothing re-flowed. Its live panel
matches the landing's `rounded-2xl`.

**Accents (follow-up, same day).** Teal alone read flat, so three semantic
accents sit beside it — each with one job, never decoration: `--live`
(coral) for anything happening *now* (presence counts, ping dots, LIVE
badges, unread dots, "N new" pills, the bell badge); `--gold` (amber) for
time and scores (countdowns, airing-soon, ★ ratings); `--lilac` for the
spoiler shield. Teal keeps links, CTAs, the headline word and focus rings.
The landing/home ambience glows rotate through the other hues down the
page. Rule for new UI: pick by meaning, not by mood.

### Come-back loop + discovery restructure (M3.8)

*(From Miguel's 2026-09-04 ask, after M3.7: "when we are logged in there's a
lack of movement and incentive"; threads "is just a giant bulletin board";
schedule "gives too little information about too many things"; trending
and hidden gems "have quite the level of overlap".)*

**Your pulse.** The home's first block once signed in. Three cards:
*Streak* — consecutive days with any activity (a +1 counts; the point is
showing up), seven-day dots, and a sentence that always says what to do
next; the run survives an unfinished today so the home is exactly where
you'd extend it. *Badges* — thresholds on lifetime counters (first word,
regular, seven nights, finisher, first in the room, night owl, crowd
pleaser, …) plus the single closest unearned one with a progress bar: the
nudge must feel reachable. *Replies to you* — other members' replies to
your comments, and the reactions your comments drew this week. Rule: the
block shows what *moved since last time*; it never manufactures urgency
from nothing (empty states say what would fill them).

**Rooms hub.** The reason the tab exists, stated: a show page can't rank
rooms *across* shows, and nothing else lists every room for *your* list.
Views: Hot (trending order, podium of three, heat bar = recent comments
relative to the hottest, presence in coral), Tonight (schedule-anchored,
unchanged), My shows (signed-in: one row per list entry joined with the hot
list and tonight's openings — live first, then opening tonight, then quiet
by list status; dropped excluded), Series talk. Sort (hottest / most
comments / latest) and a title filter work inside any view.

**Schedule.** A day strip (seven days, count per day) and a lens instead of
a seven-day wall. Lenses: My shows (default when the viewer's week is
non-empty), Popular (the top third of the week's distinct shows — relative,
so a thin week still has a list), Everything. Rows are compact: time,
cover, title, "yours" pill, countdown or "aired · room open". The home's
"this week" strip stays as the merged summary; the tab is for choosing a
day.

**Trending, argued.** Twelve cards, each with its signal chips (strongest
first, in the ranking's own weight order) and — signed in — the reasons
relative to the viewer: followees who have it on their list (names, then
+N), the viewer's own status, genres shared with their top five. Ranks
13–30 follow as a compact "also rising" grid. **Hidden gems, de-noised:**
no music videos; shorts/OVAs/specials docked 3–6 points so a full show
outranks a 5-minute special at the same score; anything in the trending
top-50 excluded (a gem is by definition not what everyone's talking
about); format chips and a per-card "★ 84 · only 1.2k on lists" reason.

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
