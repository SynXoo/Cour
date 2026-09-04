import type { components } from "@/lib/api/schema";

export type Pulse = components["schemas"]["Pulse"];
export type Streak = components["schemas"]["Streak"];
export type Badge = components["schemas"]["Badge"];
export type BadgeTier = components["schemas"]["BadgeTier"];
export type RoomKind = components["schemas"]["RoomKind"];

/** Where a room lives: the episode page, or the series board. */
export function roomHref(animeId: number, kind: RoomKind, episode: number | null): string {
  return kind === "episode" && episode != null
    ? `/anime/${animeId}/episode/${episode}`
    : `/anime/${animeId}/discussion`;
}

/** "Ep 7 room" / "Series room" */
export function roomLabel(kind: RoomKind, episode: number | null): string {
  return kind === "episode" && episode != null ? `Ep ${episode} room` : "Series room";
}

/**
 * The one line under the streak number. It always says what to do next —
 * the number is the reward, the sentence is the hook.
 */
export function streakMessage(s: Streak): string {
  if (s.active_today) {
    return s.current >= 2 ? "Locked in for today. Same time tomorrow?" : "Day one, done. Come back tomorrow.";
  }
  if (s.current > 0) {
    return "Still alive — a +1 or a comment keeps it going.";
  }
  return s.best > 0 ? `Best run: ${s.best} days. Start a new one tonight.` : "Start a streak tonight: +1 an episode.";
}

/** Tailwind classes per tier — the accent palette's jobs, reused. */
export function badgeTone(tier: BadgeTier): string {
  switch (tier) {
    case "gold":
      return "border-gold/40 bg-gold/10 text-gold";
    case "silver":
      return "border-lilac/40 bg-lilac/10 text-lilac";
    default:
      return "border-live/40 bg-live/10 text-live";
  }
}

/** Which weekday letter each `week` slot is, given today's date. */
export function weekLetters(today: Date): string[] {
  const letters = ["S", "M", "T", "W", "T", "F", "S"];
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(letters[d.getDay()]);
  }
  return out;
}
