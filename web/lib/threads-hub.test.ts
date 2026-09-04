import { describe, expect, it } from "vitest";
import type { AnimeSummary, ScheduleEntry, TrendingThread } from "@/lib/api/client";
import type { ListEntryWithAnime } from "@/lib/hooks/use-list";
import type { LiveRoom } from "@/lib/landing";
import { filterRooms, hubStats, myRooms, sortRooms, tonightRooms, type TonightRoom } from "./threads-hub";

const NOW = new Date("2026-07-08T20:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function anime(id: number, over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    id,
    slug: `show-${id}`,
    title: `Show ${id}`,
    title_english: null,
    cover_image: `cover-${id}.jpg`,
    cover_color: "#abcdef",
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: 80,
    popularity: 1000,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
    ...over,
  };
}

const sched = (animeId: number, episode: number, airingAt: string): ScheduleEntry => ({
  anime: anime(animeId),
  episode,
  airing_at: airingAt,
});

function thread(
  id: number,
  animeId: number,
  episodeNumber: number | null,
  over: Partial<Pick<TrendingThread, "presence">> & { comment_count?: number } = {},
): TrendingThread {
  const { comment_count = 10, ...rest } = over;
  return {
    thread: {
      id,
      anime_id: animeId,
      kind: episodeNumber == null ? "series" : "episode",
      comment_count,
      last_activity_at: NOW.toISOString(),
    },
    anime: anime(animeId),
    episode:
      episodeNumber == null ? null : { number: episodeNumber, title: null, airing_at: null },
    recent_comments: 4,
    presence: 0,
    ...rest,
  };
}

describe("tonightRooms", () => {
  it("keeps the tonight window, orders soonest-first, and links to the episode thread", () => {
    const schedule = [
      sched(1, 9, at(3)), // tonight
      sched(2, 4, at(30)), // beyond 24h — excluded
      sched(3, 2, at(-0.5)), // just aired, still in the grace window
      sched(4, 1, at(-2)), // aired 2h ago — outside the 1h grace, excluded
    ];
    const got = tonightRooms(schedule, [], NOW);
    expect(got.map((r) => r.animeId)).toEqual([3, 1]); // just-aired leads
    expect(got[1].href).toBe("/anime/1/episode/9");
    expect(got[0].episode).toBe(2);
  });

  it("enriches a room with live stats when its episode thread is trending", () => {
    const schedule = [sched(1, 9, at(2)), sched(2, 4, at(4))];
    const threads = [thread(50, 1, 9, { comment_count: 42, presence: 7 })];
    const got = tonightRooms(schedule, threads, NOW);
    const hot = got.find((r) => r.animeId === 1)!;
    expect(hot.comments).toBe(42);
    expect(hot.presence).toBe(7);
    // A show with no trending thread stays at zero, not undefined.
    const quiet = got.find((r) => r.animeId === 2)!;
    expect(quiet.comments).toBe(0);
    expect(quiet.presence).toBe(0);
  });

  it("is empty when nothing airs in the window", () => {
    expect(tonightRooms([sched(1, 9, at(48))], [], NOW)).toEqual([]);
  });
});

/* ── §M3.8 hub views ─────────────────────────────────────────────────── */

function live(id: number, animeId: number, over: Partial<LiveRoom> = {}): LiveRoom {
  return {
    threadId: id,
    animeId,
    kind: "episode",
    episode: 3,
    title: `Show ${animeId}`,
    cover: null,
    label: "Ep 3 room",
    commentCount: 10,
    recent: 2,
    presence: 0,
    ago: "1h ago",
    lastActivityAt: at(-1),
    href: `/anime/${animeId}/episode/3`,
    ...over,
  };
}

function entry(animeId: number, status: ListEntryWithAnime["status"]): ListEntryWithAnime {
  return {
    anime_id: animeId,
    anime: anime(animeId),
    status,
    score: null,
    progress: 0,
    started_on: null,
    finished_on: null,
    notes: null,
    updated_at: NOW.toISOString(),
  } as ListEntryWithAnime;
}

describe("sortRooms / filterRooms / hubStats", () => {
  const rooms = [
    live(1, 1, { commentCount: 5, lastActivityAt: at(-3), title: "Frieren" }),
    live(2, 2, { commentCount: 50, lastActivityAt: at(-1), title: "Dandadan" }),
    live(3, 3, { commentCount: 20, lastActivityAt: at(-2), title: "Frieren S2", presence: 4, recent: 9 }),
  ];

  it("keeps trending order for hot, and sorts the other two", () => {
    expect(sortRooms(rooms, "hot").map((r) => r.threadId)).toEqual([1, 2, 3]);
    expect(sortRooms(rooms, "comments").map((r) => r.threadId)).toEqual([2, 3, 1]);
    expect(sortRooms(rooms, "latest").map((r) => r.threadId)).toEqual([2, 3, 1]);
    expect(rooms.map((r) => r.threadId)).toEqual([1, 2, 3]); // input untouched
  });

  it("filters by title, case-insensitively, passing everything on blank", () => {
    expect(filterRooms(rooms, "  frieren ").map((r) => r.threadId)).toEqual([1, 3]);
    expect(filterRooms(rooms, "")).toHaveLength(3);
  });

  it("sums the header stats", () => {
    expect(hubStats(rooms)).toEqual({ rooms: 3, present: 4, recent: 13 });
  });
});

describe("myRooms", () => {
  const hot = [
    live(10, 1, { presence: 0, recent: 1 }),
    live(11, 2, { presence: 3, recent: 6 }),
    live(12, 2, { presence: 0, recent: 1, kind: "series", episode: null }),
  ];
  const tonight: TonightRoom[] = [
    {
      animeId: 3,
      title: "Show 3",
      cover: null,
      coverColor: null,
      episode: 5,
      airingAt: at(2),
      href: "/anime/3/episode/5",
      presence: 0,
      comments: 0,
    },
  ];

  it("joins the list with hot and tonight rooms, live first, dropped excluded", () => {
    const rows = myRooms(
      [entry(4, "completed"), entry(3, "watching"), entry(1, "planning"), entry(2, "watching"), entry(5, "dropped")],
      hot,
      tonight,
    );
    expect(rows.map((r) => r.anime.id)).toEqual([2, 1, 3, 4]);
    expect(rows[0].room?.threadId).toBe(11); // the hottest room per show wins
    expect(rows[2].tonight?.episode).toBe(5);
    expect(rows[2].href).toBe("/anime/3/episode/5");
    expect(rows[3].room).toBeNull();
    expect(rows[3].href).toBe("/anime/4/discussion");
  });

  it("orders quiet shows by list status", () => {
    const rows = myRooms([entry(7, "completed"), entry(8, "paused"), entry(9, "watching")], [], []);
    expect(rows.map((r) => r.anime.id)).toEqual([9, 8, 7]);
  });
});
