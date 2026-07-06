import type { AnimeSummary } from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";

// ── Sort ────────────────────────────────────────────────────────────────────

export type SeasonalSort = "popularity" | "score" | "title" | "weekday" | "newest";

export const SEASONAL_SORTS: { value: SeasonalSort; label: string }[] = [
  { value: "popularity", label: "Popularity" },
  { value: "score", label: "Score" },
  { value: "title", label: "Title" },
  { value: "weekday", label: "Airing day" },
  { value: "newest", label: "Newest" },
];

export const DEFAULT_SORT: SeasonalSort = "popularity";

const SORT_VALUES = SEASONAL_SORTS.map((s) => s.value);

export function parseSort(v: string | null): SeasonalSort {
  return v && SORT_VALUES.includes(v as SeasonalSort) ? (v as SeasonalSort) : DEFAULT_SORT;
}

// ── Format groups ────────────────────────────────────────────────────────────
// Mirror the seasonal chart's default TV / Movies / OVA grouping. `null` (no
// format) rides along with the specials bucket, same as the grouped view.

export type FormatGroupId = "tv" | "movies" | "special";

export const FORMAT_GROUPS: {
  id: FormatGroupId;
  label: string;
  formats: (string | null)[];
}[] = [
  { id: "tv", label: "TV", formats: ["TV", "TV_SHORT"] },
  { id: "movies", label: "Movies", formats: ["MOVIE"] },
  { id: "special", label: "OVA / ONA / Specials", formats: ["OVA", "ONA", "SPECIAL", "MUSIC", null] },
];

export function formatGroupOf(format: string | null | undefined): FormatGroupId {
  const f = format ?? null;
  for (const g of FORMAT_GROUPS) if (g.formats.includes(f)) return g.id;
  return "special";
}

export function parseFormatGroup(v: string | null): FormatGroupId | null {
  return v && FORMAT_GROUPS.some((g) => g.id === v) ? (v as FormatGroupId) : null;
}

// ── Weekday ──────────────────────────────────────────────────────────────────
// Lowercase full names for URL params, Monday-first ordering. Derived from the
// next airing instant, so it reflects the viewer's local weekday.

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

/** Local weekday of an airing instant, or null when there's no next airing. */
export function weekdayOf(iso: string | null | undefined): Weekday | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // getDay(): 0 = Sun … 6 = Sat → remap to Monday-first index.
  return WEEKDAYS[(d.getDay() + 6) % 7];
}

export function parseWeekday(v: string | null): Weekday | null {
  return v && WEEKDAYS.includes(v as Weekday) ? (v as Weekday) : null;
}

// ── Filtering + sorting ──────────────────────────────────────────────────────

export type SeasonalFilters = {
  format: FormatGroupId | null;
  genre: string | null;
  day: Weekday | null;
};

export const EMPTY_FILTERS: SeasonalFilters = { format: null, genre: null, day: null };

export function hasActiveFilters(f: SeasonalFilters): boolean {
  return f.format != null || f.genre != null || f.day != null;
}

/** Default view = default sort AND no filters → keep the format grouping. */
export function isGroupedView(sort: SeasonalSort, f: SeasonalFilters): boolean {
  return sort === DEFAULT_SORT && !hasActiveFilters(f);
}

export function filterAnime(list: AnimeSummary[], f: SeasonalFilters): AnimeSummary[] {
  return list.filter((a) => {
    if (f.format && formatGroupOf(a.format) !== f.format) return false;
    if (f.genre && !a.genres.includes(f.genre)) return false;
    if (f.day && weekdayOf(a.next_airing_at) !== f.day) return false;
    return true;
  });
}

const byTitle = (a: AnimeSummary, b: AnimeSummary) =>
  displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: "base" });

const weekdayRank = (iso: string | null | undefined): number => {
  const w = weekdayOf(iso);
  return w ? WEEKDAYS.indexOf(w) : WEEKDAYS.length; // nulls sort last
};

const airingMs = (iso: string | null | undefined): number =>
  iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY;

/** Returns a new, sorted array — never mutates the input. */
export function sortAnime(list: AnimeSummary[], sort: SeasonalSort): AnimeSummary[] {
  const copy = [...list];
  switch (sort) {
    case "score":
      // Highest community score first; unscored titles fall to the bottom.
      return copy.sort(
        (a, b) => (b.average_score ?? -1) - (a.average_score ?? -1) || b.popularity - a.popularity,
      );
    case "title":
      return copy.sort(byTitle);
    case "weekday":
      return copy.sort(
        (a, b) =>
          weekdayRank(a.next_airing_at) - weekdayRank(b.next_airing_at) ||
          airingMs(a.next_airing_at) - airingMs(b.next_airing_at) ||
          b.popularity - a.popularity,
      );
    case "newest":
      // No premiere date on the summary; the AniList id is a reliable
      // chronological proxy (higher id ≈ more recently catalogued).
      return copy.sort((a, b) => b.id - a.id);
    case "popularity":
    default:
      return copy.sort((a, b) => b.popularity - a.popularity || byTitle(a, b));
  }
}

/** Filter, then sort — the pipeline the seasonal view renders. */
export function arrangeAnime(
  list: AnimeSummary[],
  sort: SeasonalSort,
  f: SeasonalFilters,
): AnimeSummary[] {
  return sortAnime(filterAnime(list, f), sort);
}

/** Union of every genre present in the season, alphabetised. */
export function collectGenres(list: AnimeSummary[]): string[] {
  const set = new Set<string>();
  for (const a of list) for (const g of a.genres) set.add(g);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Weekdays that at least one title airs on, in Monday-first order. */
export function collectWeekdays(list: AnimeSummary[]): Weekday[] {
  const present = new Set<Weekday>();
  for (const a of list) {
    const w = weekdayOf(a.next_airing_at);
    if (w) present.add(w);
  }
  return WEEKDAYS.filter((w) => present.has(w));
}
