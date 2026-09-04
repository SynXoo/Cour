import type { AnimeSummary } from "@/lib/api/client";

export type GemGroup = "all" | "tv" | "movies" | "shorts";

export const GEM_GROUPS: { value: GemGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tv", label: "TV" },
  { value: "movies", label: "Movies" },
  { value: "shorts", label: "Shorts, OVAs & specials" },
];

/** Which chip a format belongs to. Unknown formats ride with TV. */
export function gemGroup(format: AnimeSummary["format"]): Exclude<GemGroup, "all"> {
  switch (format) {
    case "MOVIE":
      return "movies";
    case "OVA":
    case "ONA":
    case "SPECIAL":
    case "TV_SHORT":
    case "MUSIC":
      return "shorts";
    default:
      return "tv";
  }
}

export function filterGems(anime: AnimeSummary[], group: GemGroup): AnimeSummary[] {
  if (group === "all") return anime;
  return anime.filter((a) => gemGroup(a.format) === group);
}

/** 1234 → "1.2k", 987 → "987", 12345 → "12k". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

/** "★ 84 · only 1.2k on lists" — the reason it's a gem, in one line. */
export function gemReason(a: AnimeSummary): string {
  const score = a.average_score != null ? `★ ${a.average_score}` : "unrated";
  return `${score} · only ${compactCount(a.popularity)} on lists`;
}
