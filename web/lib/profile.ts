import type { components } from "@/lib/api/schema";

export type UserProfile = components["schemas"]["UserProfile"];
export type ProfileBanner = components["schemas"]["ProfileBanner"];
export type ProfileStats = components["schemas"]["ProfileStats"];
export type UserList = components["schemas"]["UserList"];
export type ListStatus = components["schemas"]["ListStatus"];
export type ListEntryWithAnime = components["schemas"]["ListEntryWithAnime"];
export type ScoreBias = components["schemas"]["ScoreBias"];
export type SeasonCount = components["schemas"]["SeasonCount"];
export type FormatCount = components["schemas"]["FormatCount"];
export type Format = components["schemas"]["Format"];

export type LibrarySort = "updated" | "score" | "title";

/** The library browse state shared by the stats (which set filters) and the
 * tabs (which render them). "all" is the histogram/genre landing tab — an
 * exact-score filter cuts across statuses. */
export type LibraryFilter = {
  status: ListStatus | "all";
  score: number | null;
  genre: string | null;
  year: number | null;
  format: Format | null;
};

export const STATUS_TABS: { value: ListStatus; label: string }[] = [
  { value: "watching", label: "Watching" },
  { value: "completed", label: "Completed" },
  { value: "planning", label: "Planning" },
  { value: "paused", label: "Paused" },
  { value: "dropped", label: "Dropped" },
];

/** "9d 4h" / "4h 32m" / "51m"; null when nothing has been watched. */
export function formatWatchTime(minutes: number): string | null {
  if (minutes <= 0) return null;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.floor(minutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** The page accent: the owner's explicit pick wins, else the banner anime's
 * color, else the first favorite that has one. Null profiles stay on the
 * theme's own primary. */
export function profileTint(
  accent: string | null,
  banner: ProfileBanner | null,
  favorites: { cover_color: string | null }[],
): string | null {
  return (
    accent ?? banner?.cover_color ?? favorites.find((f) => f.cover_color)?.cover_color ?? null
  );
}

/** Distinct cover colors from the owner's favorites, in shelf order — the
 * accent picker's swatches. Deduped case-insensitively; AniList hands back
 * mixed case for the same hex across shows. */
export function accentSwatches(
  favorites: { id: number; cover_color: string | null }[],
  cap = 8,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of favorites) {
    if (!f.cover_color) continue;
    const hex = f.cover_color.toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
    if (out.length >= cap) break;
  }
  return out;
}

/** Covers for the hero's fallback poster wall: favorites lead (they are the
 * owner's loudest taste signal), currently-watching fills, deduped. */
export function fallbackWallCovers(
  favorites: { id: number; cover_image: string | null }[],
  watching: { anime: { id: number; cover_image: string | null } }[],
  cap = 14,
): { id: number; cover_image: string }[] {
  const seen = new Set<number>();
  const out: { id: number; cover_image: string }[] = [];
  for (const a of [...favorites, ...watching.map((w) => w.anime)]) {
    if (!a.cover_image || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ id: a.id, cover_image: a.cover_image });
    if (out.length >= cap) break;
  }
  return out;
}

/** Total library size across the five statuses. */
export function libraryTotal(counts: ProfileStats["counts"]): number {
  return (
    counts.watching + counts.completed + counts.planning + counts.paused + counts.dropped
  );
}

/** Next page number for the public list, or null at the end. */
export function nextListPage(page: {
  page: number;
  per_page: number;
  total: number;
}): number | null {
  return page.page * page.per_page < page.total ? page.page + 1 : null;
}

/** How the owner grades against everyone else. `delta` is signed: negative
 * means they rate below the crowd. The bands are deliberately wide — a tenth
 * of a point either way is noise, not a personality. */
export function criticVerdict(bias: ScoreBias): { label: string; delta: number } {
  const delta = bias.user_mean - bias.community_mean;
  if (delta <= -1) return { label: "Harsh critic", delta };
  if (delta <= -0.35) return { label: "Tough grader", delta };
  if (delta < 0.35) return { label: "In step with the crowd", delta };
  if (delta < 1) return { label: "Generous", delta };
  return { label: "Easy to please", delta };
}

/** How much of the 1-10 scale actually gets used. Population stddev: ~0.5 is
 * a user whose every show is a 7 or an 8; ~2 is one who rates 3s and 10s. */
export function scaleVerdict(stddev: number): string {
  if (stddev < 0.8) return "Plays it safe";
  if (stddev < 1.8) return "Balanced range";
  return "Uses the whole scale";
}

/** Of the shows the owner started and stopped — completed, dropped, or parked
 * — what fraction they saw through. Planning never started; watching hasn't
 * stopped. Null when nothing has settled. Range 0-1. */
export function completionRate(counts: ProfileStats["counts"]): number | null {
  const settled = counts.completed + counts.dropped + counts.paused;
  return settled === 0 ? null : counts.completed / settled;
}

/** The complement worth naming on its own: how often a show gets abandoned.
 * Same denominator as completionRate, so the two are comparable. */
export function dropRate(counts: ProfileStats["counts"]): number | null {
  const settled = counts.completed + counts.dropped + counts.paused;
  return settled === 0 ? null : counts.dropped / settled;
}

/** Average episodes logged per show on the shelves. Null on an empty library. */
export function meanEpisodesPerShow(episodesWatched: number, total: number): number | null {
  return total === 0 ? null : episodesWatched / total;
}

/** Two framings for the watch-time number that a raw "9d 11h" doesn't give:
 * the slice of a calendar year it eats, and the pile of feature films it
 * would have been instead. Null below a film's worth — the framing needs
 * something to frame. */
export function watchTimeFraming(
  minutes: number,
): { yearPercent: number; films: number } | null {
  if (minutes < FILM_MINUTES) return null;
  return {
    yearPercent: (minutes / MINUTES_PER_YEAR) * 100,
    films: Math.round(minutes / FILM_MINUTES),
  };
}

const FILM_MINUTES = 120;
const MINUTES_PER_YEAR = 365 * 24 * 60;

/** The era strip needs a continuous axis: a user whose completed shows are
 * 2007, 2024 and 2026 has an eighteen-year hole, and rendering three adjacent
 * bars would tell the opposite story. Zero-fills every year in between. */
export function fillEraGaps(seasons: SeasonCount[]): SeasonCount[] {
  if (seasons.length === 0) return [];
  const byYear = new Map(seasons.map((s) => [s.year, s.count]));
  const years = seasons.map((s) => s.year);
  const from = Math.min(...years);
  const to = Math.max(...years);
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    year: from + i,
    count: byYear.get(from + i) ?? 0,
  }));
}

/** The single year the owner watched most, for the "your ____ era" line.
 * Null when nothing is completed, or when no year clearly leads. */
export function peakEra(seasons: SeasonCount[]): number | null {
  let best: SeasonCount | null = null;
  let tied = false;
  for (const s of seasons) {
    if (s.count === 0) continue;
    if (best === null || s.count > best.count) {
      best = s;
      tied = false;
    } else if (s.count === best.count) {
      tied = true;
    }
  }
  return best === null || tied ? null : best.year;
}
