import type { components } from "@/lib/api/schema";

export type UserProfile = components["schemas"]["UserProfile"];
export type ProfileBanner = components["schemas"]["ProfileBanner"];
export type ProfileStats = components["schemas"]["ProfileStats"];
export type UserList = components["schemas"]["UserList"];
export type ListStatus = components["schemas"]["ListStatus"];
export type ListEntryWithAnime = components["schemas"]["ListEntryWithAnime"];

export type LibrarySort = "updated" | "score" | "title";

/** The library browse state shared by the stats (which set filters) and the
 * tabs (which render them). "all" is the histogram/genre landing tab — an
 * exact-score filter cuts across statuses. */
export type LibraryFilter = {
  status: ListStatus | "all";
  score: number | null;
  genre: string | null;
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

/** The page accent: the banner anime's color first, else the first favorite
 * that has one. Null profiles stay on the theme's own primary. */
export function profileTint(
  banner: ProfileBanner | null,
  favorites: { cover_color: string | null }[],
): string | null {
  return banner?.cover_color ?? favorites.find((f) => f.cover_color)?.cover_color ?? null;
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
