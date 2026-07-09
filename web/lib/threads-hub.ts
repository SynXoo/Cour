import type { ScheduleEntry, TrendingThread } from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";
import { roomStatsByEpisode } from "@/lib/home";
import { tonightEntries } from "@/lib/landing";

/**
 * The `/threads` hub's two lists are pure joins over the same public data the
 * home already fetches, so both are data → data and unit-testable without the
 * page. "Opening tonight" is time-anchored (the schedule); "busiest this week"
 * is popularity-anchored (trending) and reuses the landing's `buildRooms`.
 */

export type TonightRoom = {
  animeId: number;
  title: string;
  cover: string | null;
  coverColor: string | null;
  episode: number;
  airingAt: string;
  /** Into the episode thread — that's where the room is. */
  href: string;
  /** Live stats when the room is already hot (from trending), else 0. */
  presence: number;
  comments: number;
};

/**
 * Tonight's episode rooms: every show airing inside the landing's tonight
 * window (next 24 h + the 1 h just-aired grace), soonest first — a just-aired
 * episode leads, its room is open right now. Each is enriched with live
 * presence/comment counts when the thread is already trending; the countdown
 * itself ticks in the client rail. Unlike the home's `myTonight`, this is the
 * whole schedule — the hub is a public destination, not the viewer's evening.
 */
export function tonightRooms(
  schedule: ScheduleEntry[],
  threads: TrendingThread[],
  now = new Date(),
): TonightRoom[] {
  const stats = roomStatsByEpisode(threads);
  return tonightEntries(schedule, now)
    .slice()
    .sort((a, b) => new Date(a.airing_at).getTime() - new Date(b.airing_at).getTime())
    .map((e) => {
      const room = stats[`${e.anime.id}:${e.episode}`];
      return {
        animeId: e.anime.id,
        title: displayTitle(e.anime),
        cover: e.anime.cover_image,
        coverColor: e.anime.cover_color,
        episode: e.episode,
        airingAt: e.airing_at,
        href: `/anime/${e.anime.id}/episode/${e.episode}`,
        presence: room?.presence ?? 0,
        comments: room?.comments ?? 0,
      };
    });
}
