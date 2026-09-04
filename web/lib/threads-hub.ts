import type { AnimeSummary, ScheduleEntry, TrendingThread } from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";
import { roomStatsByEpisode } from "@/lib/home";
import type { ListEntryWithAnime, ListStatus } from "@/lib/hooks/use-list";
import { type LiveRoom, tonightEntries } from "@/lib/landing";

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

/* ── The hub's views (§M3.8) ─────────────────────────────────────────────
   The hub stopped being one bulletin board: a ranked "hot" list with a
   sort, a text filter, and a "my shows" view that only exists here — every
   room for the shows on *your* list, hot or quiet, in one place. Pure
   data → data so the client component stays a switch statement. */

export type RoomSort = "hot" | "comments" | "latest";

/** Heat = the trending order the API already computed; other sorts are plain. */
export function sortRooms(rooms: LiveRoom[], sort: RoomSort): LiveRoom[] {
  const out = [...rooms];
  switch (sort) {
    case "comments":
      return out.sort((a, b) => b.commentCount - a.commentCount);
    case "latest":
      return out.sort(
        (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
      );
    default:
      return out;
  }
}

/** Case-insensitive title match; an empty query passes everything. */
export function filterRooms<T extends { title: string }>(rooms: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rooms;
  return rooms.filter((r) => r.title.toLowerCase().includes(q));
}

/** Header numbers: how alive the rooms are right now. */
export function hubStats(rooms: LiveRoom[]): { rooms: number; present: number; recent: number } {
  return rooms.reduce(
    (acc, r) => ({
      rooms: acc.rooms + 1,
      present: acc.present + r.presence,
      recent: acc.recent + r.recent,
    }),
    { rooms: 0, present: 0, recent: 0 },
  );
}

export type MyRoom = {
  anime: AnimeSummary;
  status: ListStatus;
  /** The hottest trending room for this show, if any. */
  room: LiveRoom | null;
  /** The show's episode airing inside the tonight window, if any. */
  tonight: TonightRoom | null;
  /** Fallback destination when nothing is hot: the series board. */
  href: string;
};

const STATUS_RANK: Record<ListStatus, number> = {
  watching: 0,
  paused: 1,
  planning: 2,
  completed: 3,
  dropped: 4,
};

/**
 * One row per show on the viewer's list (dropped excluded), joined with the
 * hot list and tonight's rooms. Live rooms lead (presence, then recent
 * comments), then tonight's openings, then the rest by list status — a
 * watching show's quiet series board still outranks a completed one's.
 */
export function myRooms(
  entries: ListEntryWithAnime[],
  hot: LiveRoom[],
  tonight: TonightRoom[],
): MyRoom[] {
  const hotByAnime = new Map<number, LiveRoom>();
  for (const r of hot) {
    // Trending order is heat order; the first room per show is its hottest.
    if (!hotByAnime.has(r.animeId)) hotByAnime.set(r.animeId, r);
  }
  const tonightByAnime = new Map<number, TonightRoom>();
  for (const t of tonight) {
    if (!tonightByAnime.has(t.animeId)) tonightByAnime.set(t.animeId, t);
  }
  const rows: MyRoom[] = [];
  for (const e of entries) {
    if (e.status === "dropped") continue;
    const room = hotByAnime.get(e.anime_id) ?? null;
    const night = tonightByAnime.get(e.anime_id) ?? null;
    rows.push({
      anime: e.anime,
      status: e.status,
      room,
      tonight: night,
      href: room?.href ?? night?.href ?? `/anime/${e.anime_id}/discussion`,
    });
  }
  const heat = (r: MyRoom) => (r.room ? r.room.presence * 10 + r.room.recent : 0);
  return rows.sort((a, b) => {
    const ha = heat(a);
    const hb = heat(b);
    if (ha !== hb) return hb - ha;
    if (!!a.tonight !== !!b.tonight) return a.tonight ? -1 : 1;
    return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  });
}
