import type { components } from "@/lib/api/schema";
import { animeHref, displayTitle } from "@/lib/anime";

export type Notification = components["schemas"]["Notification"];
export type NotificationType = components["schemas"]["NotificationType"];

/** The bell's filter chips, in the order they render. `null` = every kind. */
export const NOTIFICATION_FILTERS: { value: NotificationType | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "comment_reply", label: "Replies" },
  { value: "new_follower", label: "Follows" },
  { value: "episode_aired", label: "Episodes" },
];

/**
 * The one-line sentence and destination for a notification. The actor's
 * @username is rendered separately by the caller, so `text` starts mid-
 * sentence for the kinds that have one.
 */
export function describeNotification(n: Notification): { text: string; href: string } {
  const p = n.payload as Record<string, unknown>;
  switch (n.type) {
    case "comment_reply": {
      const base = n.anime ? animeHref(n.anime) : "/";
      const href =
        p.kind === "episode" && n.anime && typeof p.episode === "number"
          ? `/anime/${n.anime.id}/episode/${p.episode}`
          : n.anime
            ? `/anime/${n.anime.id}/discussion`
            : base;
      return {
        text: `replied to your comment${n.anime ? ` on ${displayTitle(n.anime)}` : ""}`,
        href,
      };
    }
    case "new_follower":
      return { text: "followed you", href: n.actor ? `/users/${n.actor.username}` : "/" };
    case "episode_aired": {
      const ep = typeof p.episode === "number" ? p.episode : null;
      return {
        text: `Episode ${ep ?? "?"} of ${n.anime ? displayTitle(n.anime) : "a show you watch"} just aired`,
        href: n.anime && ep ? `/anime/${n.anime.id}/episode/${ep}` : "/schedule",
      };
    }
    default:
      return { text: "did something", href: "/" };
  }
}

/** Short relative stamp for the dropdown, where the full date is too wide. */
export function relativeTime(iso: string, now = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return `${Math.floor(day / 7)}w`;
}
