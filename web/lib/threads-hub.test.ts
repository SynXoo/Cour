import { describe, expect, it } from "vitest";
import type { AnimeSummary, ScheduleEntry, TrendingThread } from "@/lib/api/client";
import { tonightRooms } from "./threads-hub";

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
