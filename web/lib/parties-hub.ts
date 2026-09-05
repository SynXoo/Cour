import { displayTitle } from "@/lib/anime";
import type { ScheduleEntry } from "@/lib/api/client";

/**
 * The `/parties` hub's "start one" list.
 *
 * The threads hub's `tonightRooms` is anchored on what is *about* to air — a
 * countdown is the point there. A party needs the opposite: an episode you
 * can press play on now. So this window leans backwards (a day of episodes
 * already out, freshest first) and keeps the next few hours after it, for
 * the person planning the evening rather than starting it.
 */

const HOUR_MS = 3_600_000;

export type HostableEpisode = {
  animeId: number;
  title: string;
  cover: string | null;
  coverColor: string | null;
  episode: number;
  airingAt: string;
  /** The episode page — its launcher owns starting a room. */
  href: string;
};

/** How far either side of now the hub looks; also the schedule fetch window. */
export const HOSTABLE_PAST_HOURS = 24;
export const HOSTABLE_FUTURE_HOURS = 12;

export function hostableWindow(now = new Date()): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - HOSTABLE_PAST_HOURS * HOUR_MS).toISOString(),
    to: new Date(now.getTime() + HOSTABLE_FUTURE_HOURS * HOUR_MS).toISOString(),
  };
}

/**
 * Episodes worth opening a room on: everything that aired inside the past
 * window, newest first (the drop everyone is watching tonight leads), then
 * what is still to come, soonest first. Entries outside the window are
 * dropped, so a caller can hand over a whole week of schedule.
 */
export function hostableEpisodes(
  entries: ScheduleEntry[],
  now = new Date(),
): HostableEpisode[] {
  const t = now.getTime();
  const start = t - HOSTABLE_PAST_HOURS * HOUR_MS;
  const end = t + HOSTABLE_FUTURE_HOURS * HOUR_MS;

  const inWindow = entries.filter((e) => {
    const at = new Date(e.airing_at).getTime();
    return at >= start && at < end;
  });

  const aired = inWindow
    .filter((e) => new Date(e.airing_at).getTime() <= t)
    .sort((a, b) => new Date(b.airing_at).getTime() - new Date(a.airing_at).getTime());
  const upcoming = inWindow
    .filter((e) => new Date(e.airing_at).getTime() > t)
    .sort((a, b) => new Date(a.airing_at).getTime() - new Date(b.airing_at).getTime());

  return [...aired, ...upcoming].map((e) => ({
    animeId: e.anime.id,
    title: displayTitle(e.anime),
    cover: e.anime.cover_image,
    coverColor: e.anime.cover_color,
    episode: e.episode,
    airingAt: e.airing_at,
    href: `/anime/${e.anime.id}/episode/${e.episode}`,
  }));
}
