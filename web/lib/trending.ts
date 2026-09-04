import type { components } from "@/lib/api/schema";

export type ExplainedTrending = components["schemas"]["ExplainedTrending"];
export type TrendingSignals = components["schemas"]["TrendingSignals"];
export type TrendingYou = components["schemas"]["TrendingYou"];

export type SignalChip = { key: keyof TrendingSignals; label: string };

// Display order = the ranking's own weights (review > favorite > comment >
// completed > list add > scored), so the first chip is the strongest reason.
const SIGNAL_ORDER: { key: keyof TrendingSignals; one: string; many: string }[] = [
  { key: "reviews", one: "review", many: "reviews" },
  { key: "favorites", one: "favorite", many: "favorites" },
  { key: "comments", one: "comment", many: "comments" },
  { key: "completed", one: "finished it", many: "finished it" },
  { key: "list_adds", one: "list add", many: "list adds" },
  { key: "scored", one: "rating", many: "ratings" },
];

/** Nonzero signals as "14 comments"-style chips, strongest first, capped. */
export function signalChips(s: TrendingSignals, cap = 3): SignalChip[] {
  const out: SignalChip[] = [];
  for (const def of SIGNAL_ORDER) {
    const n = s[def.key];
    if (n <= 0) continue;
    out.push({ key: def.key, label: `${n} ${n === 1 ? def.one : def.many}` });
    if (out.length >= cap) break;
  }
  return out;
}

const STATUS_WORD: Record<string, string> = {
  watching: "You're watching it",
  completed: "You finished it",
  planning: "On your planning list",
  paused: "Paused on your list",
  dropped: "You dropped it",
};

/**
 * The viewer-relative reasons, as short sentences. Social first (a name is
 * the strongest pull), then the viewer's own relationship, then taste.
 * Empty when there's nothing personal to say — the caller hides the line.
 */
export function youLines(you: TrendingYou | null | undefined): string[] {
  if (!you) return [];
  const out: string[] = [];
  if (you.followees_count > 0) {
    const names = you.followees.map((n) => `@${n}`);
    const extra = you.followees_count - names.length;
    const who = extra > 0 ? `${names.join(", ")} +${extra}` : names.join(", ");
    out.push(`${who} ${you.followees_count === 1 && extra === 0 ? "has" : "have"} it on their list`);
  }
  if (you.status) out.push(STATUS_WORD[you.status] ?? "On your list");
  if (you.shared_genres.length > 0) {
    out.push(`${you.shared_genres.join(" · ")} — your kind of show`);
  }
  return out;
}

/** "the last 14 days" style label for the window, from the doc constant. */
export const TRENDING_WINDOW_DAYS = 14;
