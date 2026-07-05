import type { AnimeSummary, Season } from "@/lib/api/client";

export const SEASONS: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

export function currentSeason(date = new Date()): { season: Season; year: number } {
  const m = date.getMonth(); // 0-based
  if (m <= 2) return { season: "WINTER", year: date.getFullYear() };
  if (m <= 5) return { season: "SPRING", year: date.getFullYear() };
  if (m <= 8) return { season: "SUMMER", year: date.getFullYear() };
  return { season: "FALL", year: date.getFullYear() };
}

export function nextSeason(season: Season, year: number): { season: Season; year: number } {
  const i = SEASONS.indexOf(season);
  if (i === 3) return { season: "WINTER", year: year + 1 };
  return { season: SEASONS[i + 1], year };
}

export function prevSeason(season: Season, year: number): { season: Season; year: number } {
  const i = SEASONS.indexOf(season);
  if (i === 0) return { season: "FALL", year: year - 1 };
  return { season: SEASONS[i - 1], year };
}

export function seasonLabel(season: Season): string {
  return season.charAt(0) + season.slice(1).toLowerCase();
}

const FORMAT_LABELS: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV Short",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music",
};

export function formatLabel(format: string | null | undefined): string | null {
  return format ? (FORMAT_LABELS[format] ?? format) : null;
}

export function animeHref(anime: Pick<AnimeSummary, "id" | "slug">): string {
  return `/anime/${anime.id}/${anime.slug}`;
}

export function displayTitle(anime: Pick<AnimeSummary, "title" | "title_english">): string {
  return anime.title_english ?? anime.title;
}

/** "in 2d 4h" / "in 3h 12m" / "airing now" for upcoming episode times. */
export function untilLabel(iso: string, from = new Date()): string {
  const ms = new Date(iso).getTime() - from.getTime();
  if (ms <= 0) return "airing now";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

export function isUpcoming(iso: string | null | undefined): boolean {
  return iso != null && new Date(iso).getTime() > Date.now();
}

export function airDateLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
