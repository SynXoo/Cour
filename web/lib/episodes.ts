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

export type EpisodeOrder = "asc" | "desc";
export const DEFAULT_ORDER: EpisodeOrder = "desc";

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
 * actually contain episodes, ordered newest-first (highest range first) to
 * match the newest-first default. Labels span the full bucket ("1051–1100")
 * even when the top bucket is only partially filled.
 */
export function buildRanges(episodes: Episode[]): EpisodeRange[] {
  const counts = new Map<number, number>();
  for (const e of episodes) {
    const b = bucketOf(e.number);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => b - a)
    .map((b) => {
      const lo = b * RANGE_SIZE + 1;
      const hi = lo + RANGE_SIZE - 1;
      return { id: String(lo), lo, hi, label: `${lo}–${hi}`, count: counts.get(b)! };
    });
}

export function inRange(episode: Episode, range: EpisodeRange): boolean {
  return episode.number >= range.lo && episode.number <= range.hi;
}

export function orderEpisodes(episodes: Episode[], order: EpisodeOrder): Episode[] {
  const sorted = [...episodes].sort((a, b) => a.number - b.number);
  return order === "desc" ? sorted.reverse() : sorted;
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
