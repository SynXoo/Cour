import type { components } from "@/lib/api/schema";

export type Episode = components["schemas"]["Episode"];

/** Episodes per range page ("1–50", "51–100", …). */
export const RANGE_SIZE = 50;
/**
 * At or below this count the list renders exactly as it always has — a plain
 * ascending column, no order toggle, no range chips. Pagination only kicks in
 * for the long-running shows that need it (One Piece scale).
 */
export const PAGINATION_THRESHOLD = 50;

export type EpisodeRange = {
  /** Stable identity for React keys / selection — the range's low bound. */
  id: string;
  lo: number;
  hi: number;
  label: string;
  count: number;
};

export function needsPagination(episodes: Episode[]): boolean {
  return episodes.length > PAGINATION_THRESHOLD;
}

/** 0-based range bucket for an episode number; anything below 1 folds into the first. */
function bucketOf(n: number): number {
  return Math.max(0, Math.floor((n - 1) / RANGE_SIZE));
}

/**
 * Fixed episode-number buckets of RANGE_SIZE, but only the buckets that
 * actually contain episodes, ascending — the rail and its range stepper both
 * read left-to-right. Labels span the full bucket ("1051–1100") even when the
 * top bucket is only partially filled.
 */
export function buildRanges(episodes: Episode[]): EpisodeRange[] {
  const counts = new Map<number, number>();
  for (const e of episodes) {
    const b = bucketOf(e.number);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => a - b)
    .map((b) => {
      const lo = b * RANGE_SIZE + 1;
      const hi = lo + RANGE_SIZE - 1;
      return { id: String(lo), lo, hi, label: `${lo}–${hi}`, count: counts.get(b)! };
    });
}

export function inRange(episode: Episode, range: EpisodeRange): boolean {
  return episode.number >= range.lo && episode.number <= range.hi;
}

/**
 * The episode the "Latest episode" button jumps to: the aired episode with the
 * most recent airing time, or — when nothing has aired yet or no air dates are
 * known — the highest-numbered episode. Null only for an empty list.
 */
export function latestAiredEpisode(episodes: Episode[], now: number = Date.now()): Episode | null {
  if (episodes.length === 0) return null;
  let latestAired: Episode | null = null;
  let latestAt = -Infinity;
  for (const e of episodes) {
    if (!e.airing_at) continue;
    const t = new Date(e.airing_at).getTime();
    if (t <= now && t > latestAt) {
      latestAired = e;
      latestAt = t;
    }
  }
  if (latestAired) return latestAired;
  return episodes.reduce((max, e) => (e.number > max.number ? e : max));
}

// ── You are here (docs/PHASE_2.md §M3.10) ────────────────────────────────

export type EpisodeState = "watched" | "next" | "ahead";

/**
 * The episode the viewer should watch next: the lowest-numbered one past
 * their progress. Null when they're caught up (or the list is empty).
 */
export function nextUpNumber(episodes: Episode[], progress: number): number | null {
  let best: number | null = null;
  for (const e of episodes) {
    if (e.number > progress && (best == null || e.number < best)) best = e.number;
  }
  return best;
}

/** How a row reads against the viewer's progress; null without a list entry. */
export function episodeState(
  number: number,
  progress: number | null | undefined,
  nextUp: number | null,
): EpisodeState | null {
  if (progress == null) return null;
  if (number <= progress) return "watched";
  if (number === nextUp) return "next";
  return "ahead";
}

/** The range page that holds an episode number, if any. */
export function rangeContaining(ranges: EpisodeRange[], number: number | null): EpisodeRange | undefined {
  if (number == null) return undefined;
  return ranges.find((r) => number >= r.lo && number <= r.hi);
}

/**
 * The sentence above the list once the viewer has an entry. Reads as
 * where they are, not as a chart.
 */
export function progressSummary(progress: number, total: number | null, nextUp: number | null): string {
  if (total != null && total > 0 && progress >= total) {
    return `You've watched all ${total} episodes`;
  }
  if (progress <= 0) {
    return nextUp != null ? `Not started yet — episode ${nextUp} is up next` : "Not started yet";
  }
  const of = total ? ` of ${total}` : "";
  const toGo = total ? ` · ${total - progress} to go` : "";
  return `You're on episode ${progress}${of}${toGo}`;
}

// ── Getting somewhere (docs/PHASE_2.md §M3.11) ───────────────────────────

/** How many matches the jump box offers at once. */
export const SEARCH_LIMIT = 8;

/**
 * Matches for the jump box. An all-digits query searches episode numbers —
 * the exact hit first, then numbers that merely start with it, so typing
 * "10" on One Piece offers 10, then 100, 1000, 1001… Anything else searches
 * episode titles. Empty query, empty result: the box shows nothing until
 * you've said something.
 */
export function searchEpisodes(
  episodes: Episode[],
  query: string,
  limit = SEARCH_LIMIT,
): Episode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byNumber = [...episodes].sort((a, b) => a.number - b.number);
  if (/^\d+$/.test(q)) {
    const exact = byNumber.filter((e) => String(e.number) === q);
    const prefixed = byNumber.filter((e) => String(e.number) !== q && String(e.number).startsWith(q));
    return [...exact, ...prefixed].slice(0, limit);
  }
  return byNumber.filter((e) => e.title?.toLowerCase().includes(q)).slice(0, limit);
}

/** One button in the jump row. The first is the page's primary action. */
export type JumpTarget = {
  key: "continue" | "start" | "latest";
  label: string;
  number: number;
};

/**
 * The ways into a show, deduped by episode: pick up where you left off,
 * start at the beginning, jump to the newest one out. A viewer who hasn't
 * started gets "Start" rather than a "Continue" pointing at episode 1, and a
 * one-episode show gets one button instead of three saying the same thing.
 */
export function jumpTargets(
  episodes: Episode[],
  nextUp: number | null,
  now: number = Date.now(),
): JumpTarget[] {
  if (episodes.length === 0) return [];
  const first = episodes.reduce((min, e) => (e.number < min.number ? e : min)).number;
  const latest = latestAiredEpisode(episodes, now)?.number ?? first;

  const targets: JumpTarget[] = [];
  const add = (key: JumpTarget["key"], label: string, number: number) => {
    if (targets.some((t) => t.number === number)) return;
    targets.push({ key, label: `${label} · Ep ${number}`, number });
  };
  if (nextUp != null && nextUp !== first) add("continue", "Continue", nextUp);
  add("start", "Start", first);
  add("latest", "Latest", latest);
  return targets;
}

/**
 * The episode the rail scrolls to on open: where the viewer is going next,
 * failing that the newest episode out. Null only for an empty list.
 */
export function anchorNumber(
  episodes: Episode[],
  nextUp: number | null,
  now: number = Date.now(),
): number | null {
  if (nextUp != null && episodes.some((e) => e.number === nextUp)) return nextUp;
  return latestAiredEpisode(episodes, now)?.number ?? null;
}

/**
 * Air date sized for a rail card: "Jul 12", or "Jul 2015" once the year
 * stops being obvious. `airDateLabel`'s full weekday-and-clock version wraps
 * to three lines in a card and stays on the `title` attribute instead.
 */
export function railDateLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    ...(sameYear ? { day: "numeric" } : { year: "numeric" }),
  });
}
