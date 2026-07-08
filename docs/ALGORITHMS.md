# Discovery algorithms

The product thesis is *recency*: what people are watching and talking about
**now**, not a hall of fame. Three algorithms carry that thesis. All of them
live in [`backend/internal/discovery`](../backend/internal/discovery) with
unit tests on the pure math.

---

## 1. Trending Now

### Formula

```
score(anime) = Σ over events e  w(type(e)) · 2^(−age(e) / H)
             + β · (upstream(anime) / max_upstream) · S
```

- `events` — every row in `activities` referencing the anime within the
  window **W = 14 days**. Activities are written transactionally with the
  user action that caused them (list add, score, review, comment, …), so the
  signal can't drift from reality.
- `age(e)` — how long ago the event happened.
- `H` — **half-life, 96 h**. An event contributes half as much every 4 days.
  A show nobody has touched for two weeks contributes ~8 % of its peak.
- `w(type)` — signal weights (defaults):

  | signal | weight | rationale |
  |---|---|---|
  | review | 3.0 | highest-effort action |
  | favorite | 2.5 | strong, rare signal |
  | comment | 1.5 | conversation = the social ritual |
  | completed | 1.2 | finished, not just started |
  | list_add | 1.0 | baseline intent |
  | scored | 0.8 | opinion attached |
  | status_change / helpful_vote | 0.5 | weak signals |
  | progress | 0.3 | frequent, low-effort |

- `β · upstream_norm · S` — a small blend of AniList's own trending signal
  (**β = 0.15**, scale **S = 20** weighted-points). This bootstraps a fresh
  install (before local activity exists) and stops a tiny community's noise
  from fully drowning global reality. Once local activity grows, the Σ term
  dominates by design.

### Why exponential decay

Linear windows create cliffs (an event is fully counted, then suddenly
worthless); exponential decay is smooth, has one intuitive knob (half-life),
and composes: doubling activity always beats aging by exactly one half-life.
The property the product wants — *recent buzz beats stale volume* — is unit
tested (`TestRecencyBeatsVolume`): 3 favorites today outrank 10 favorites
from ten days ago.

### Mechanics

An asynq job (`discovery:recompute`) runs **every 15 minutes** (and once at
worker boot): one SQL scan of the window, decay math in Go (unit-testable),
then the ranked top-100 is written to a Redis ZSET (`trending:v1`, the serve
path — reads are `ZRANGE` + one hydration query) and mirrored to the
`trending_scores` table (durability + debuggability: you can `SELECT` what
the ranking was and when).

### Tuning

Every knob is an env var — no redeploy needed to experiment:
`TRENDING_HALF_LIFE`, `TRENDING_WINDOW`, `TRENDING_BLEND`,
`TRENDING_WEIGHT_<type>` (see `.env.example`).

### Scale note

The recompute is a full window scan (fine to ~10⁶ activities on the 15-min
cadence). Past that: aggregate per (anime, hour) buckets incrementally and
decay the buckets, which turns the recompute into O(anime × hours) instead
of O(events).

---

## 1b. Thread velocity ("busiest threads right now")

The same decay shape as Trending Now, applied to a thread's comments and
tuned to a *nightly* cadence instead of a weekly one. Lives in
[`backend/internal/discussions/trending.go`](../backend/internal/discussions/trending.go)
and serves `GET /threads/trending` (the home page's "live now" rail and the
threads hub).

```
score(thread) = Σ over live comments c  2^(−age(c) / 6 h)
              + 2.0 · live_readers(thread)
```

- **Window 48 h, half-life 6 h** — a comment is worth half its heat six
  hours later and ~1 % after two days. Tonight's episode thread beats
  yesterday's even if yesterday's has more total comments.
- **Presence bonus** — every reader connected to the thread's SSE stream
  adds 2.0 (one lurker ≈ two fresh comments), so a room gathering before an
  episode ranks *before* anyone posts. Presence-only threads are included in
  the candidate set, not just commented ones.
- Deleted comments don't count (a nuked spam flood deflates immediately).
- **Mechanics:** no cron — computed on demand and cached in Redis for 60 s
  (`threads:trending:v1`, stats only). Thread/anime hydration and the
  presence counts *shown* are read live per request; only the ranking is
  60 s stale. The comment scan rides `comments_created_at_idx`.
- Constants are deliberately not env-tunable yet — revisit when M3's home
  page gives the ranking a real audience.

---

## 2. Hidden gems

The deliberate inversion of the popularity bias:

```
candidates = anime from recent seasons (season_year >= this_year − 1)
           with average_score >= 72 and popularity >= 100 (noise floor)
gems       = candidates with popularity <= P35(candidates)
ranked by  average_score DESC, popularity ASC, limit 50
```

The popularity cut is the **35th percentile of the recent pool**, not a
constant — "under-watched" stays meaningful as the catalog grows. The
`popularity >= 100` floor discards titles whose scores rest on a handful of
votes. Recomputed with the trending job; served from Redis.

---

## 3. Taste-based recommendations

"Users like you are watching…" — explainable neighbor-overlap collaborative
filtering, deliberately simple enough to reason about:

1. **Taste set** `T(u)` = favorites ∪ titles scored ≥ 8. Small, sharp,
   opt-in — the things a user would *recommend*, not merely tolerate.
2. **Candidate neighbors** — up to 200 users sharing ≥ 1 taste title.
3. **Similarity** — Jaccard: `|T(u) ∩ T(v)| / |T(u) ∪ T(v)|`; keep the top
   **25** neighbors. Jaccard over cosine because the sets are unweighted and
   small, and the result is directly interpretable ("you share 4 of 11
   favorites").
4. **Candidates** — neighbors' `watching` titles plus anything they scored
   ≥ 8 in the last 90 days, minus everything already on u's list.
5. **Ranking** —
   `score(a) = Σ_v sim(u,v) · w(signal_v)` where `w(watching) = 1.0`,
   `w(scored s) = 0.8·(s−7)`; then **× 1.5 if the title is from the current
   or previous season** — the seasonal bias that keeps recommendations about
   *now*.
6. **Explanations** — while aggregating, each neighbor's contribution is
   attributed to the taste titles they share with u; the top shared titles
   become "Because you liked X". No black box.

**Serving:** computed on demand, cached in Redis for 6 h per user
(`recs:v1:{id}`). **Cold start** (no taste signal or no overlapping users):
fall back to trending ⊎ hidden gems, labeled honestly in the UI.

**Scale note:** the neighbor query is bounded (200 candidates × small taste
sets). At real scale you'd precompute neighbor lists offline (minhash/LSH
for candidate generation) and keep the same scoring layer.

---

## Feed (related, not an algorithm)

The activity feed is **fan-out-on-read**: one keyset-paginated query over
followees' activities (`activities` indexed on `(user_id, id DESC)`), with
low-signal types (`progress`, `helpful_vote`) filtered out at read time.
Rationale and the fan-out-on-write upgrade path are in
[ARCHITECTURE.md](ARCHITECTURE.md#feed-fan-out).
