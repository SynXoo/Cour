import { describe, expect, it } from "vitest";
import type { AnimeSummary, ScheduleEntry, TrendingThread } from "@/lib/api/client";
import type { ListEntryWithAnime } from "@/lib/hooks/use-list";
import {
  continueWatching,
  greetingFor,
  myTonight,
  nextUpLater,
  pulseStats,
  roomStatsByEpisode,
  splitConversation,
  talkStatsByAnime,
  timelineMarks,
  timelineNowPct,
  timelineTicks,
} from "./home";

const NOW = new Date("2026-07-08T20:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function anime(id: number, over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    id,
    slug: `show-${id}`,
    title: `Show ${id}`,
    title_english: null,
    cover_image: `cover-${id}.jpg`,
    cover_color: null,
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

function sched(animeId: number, episode: number, airingAt: string): ScheduleEntry {
  return { anime: anime(animeId), episode, airing_at: airingAt };
}

function entry(
  animeId: number,
  progress: number,
  over: Partial<ListEntryWithAnime> = {},
  animeOver: Partial<AnimeSummary> = {},
): ListEntryWithAnime {
  return {
    anime_id: animeId,
    status: "watching",
    score: null,
    progress,
    started_on: null,
    finished_on: null,
    updated_at: NOW.toISOString(),
    anime: anime(animeId, animeOver),
    ...over,
  };
}

function thread(
  id: number,
  animeId: number,
  over: Partial<Omit<TrendingThread, "thread" | "anime">> & {
    comment_count?: number;
    episodeNumber?: number | null;
  } = {},
): TrendingThread {
  const { comment_count = 10, episodeNumber = 5, ...rest } = over;
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

describe("greetingFor", () => {
  it("maps the day into salutations", () => {
    expect(greetingFor(3)).toBe("Up late");
    expect(greetingFor(5)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good evening");
    expect(greetingFor(23)).toBe("Good evening");
  });
});

describe("myTonight", () => {
  it("keeps only my shows inside the tonight window, soonest first", () => {
    const schedule = [
      sched(1, 9, at(3)), // mine, tonight
      sched(2, 4, at(5)), // not mine
      sched(3, 2, at(-0.5)), // mine, just aired (grace window)
      sched(4, 7, at(30)), // mine, beyond 24h
    ];
    const got = myTonight(schedule, new Set([1, 3, 4]), NOW);
    expect(got.map((e) => e.anime.id)).toEqual([3, 1]); // just-aired leads
  });
});

describe("nextUpLater", () => {
  it("dedupes per show beyond the 24h horizon, soonest first, capped", () => {
    const schedule = [
      sched(1, 9, at(3)), // tonight — excluded
      sched(2, 5, at(48)),
      sched(2, 6, at(216)), // same show, later — deduped
      sched(3, 2, at(30)),
      sched(9, 1, at(26)), // not mine
    ];
    const got = nextUpLater(schedule, new Set([1, 2, 3]), NOW);
    expect(got.map((e) => e.anime.id)).toEqual([3, 2]);
    expect(nextUpLater(schedule, new Set([1, 2, 3]), NOW, 1).length).toBe(1);
  });
});

describe("continueWatching", () => {
  it("keeps shows with a watchable next episode and drops caught-up ones", () => {
    const rows = continueWatching([
      // Behind on an airing show: ep 6 airs next, so 1–5 aired, on ep 3.
      entry(1, 2, {}, { next_airing_episode: 6, next_airing_at: at(24) }),
      // Caught up to airing: next unwatched is exactly the unaired one.
      entry(2, 5, {}, { next_airing_episode: 6, next_airing_at: at(24) }),
      // Finished show, mid-run.
      entry(3, 11, {}, { status: "FINISHED", next_airing_episode: null }),
      // Finished show, fully watched.
      entry(4, 12, {}, { status: "FINISHED", next_airing_episode: null }),
      // Not yet released: nothing watchable.
      entry(5, 0, {}, { status: "NOT_YET_RELEASED", next_airing_episode: null }),
      // Unknown airing data + unknown count: stay permissive.
      entry(6, 3, {}, { episodes_count: null, next_airing_episode: null }),
    ]);
    expect(rows.map((r) => r.anime.id)).toEqual([1, 3, 6]);
    expect(rows[0]).toMatchObject({ nextEp: 3, progress: 2, total: 12 });
  });

  it("ignores non-watching entries, sorts by recency, and caps", () => {
    const rows = continueWatching(
      [
        entry(1, 1, { updated_at: at(-2) }, { next_airing_episode: 9 }),
        entry(2, 1, { updated_at: at(-1) }, { next_airing_episode: 9 }),
        entry(3, 1, { status: "completed" }, { next_airing_episode: 9 }),
      ],
      1,
    );
    expect(rows.map((r) => r.anime.id)).toEqual([2]);
  });

  it("offers ep 1 for an un-started airing show", () => {
    const rows = continueWatching([entry(1, 0, {}, { next_airing_episode: 4 })]);
    expect(rows[0].nextEp).toBe(1);
  });
});

describe("splitConversation", () => {
  it("routes off-season titles to the revival row, undated ones to current", () => {
    const { current, revival } = splitConversation(
      [
        anime(1), // current season
        anime(2, { season: "SPRING", season_year: 2013 }),
        anime(3, { season: null, season_year: null }),
        anime(4, { season: "SUMMER", season_year: 2025 }),
      ],
      "SUMMER",
      2026,
    );
    expect(current.map((a) => a.id)).toEqual([1, 3]);
    expect(revival.map((a) => a.id)).toEqual([2, 4]);
  });
});

describe("talkStatsByAnime", () => {
  it("aggregates a show's threads and keeps the hottest room's link", () => {
    const stats = talkStatsByAnime([
      thread(10, 1, { comment_count: 30, recent_comments: 8, presence: 2, episodeNumber: 9 }),
      thread(11, 1, { comment_count: 5, recent_comments: 1, presence: 1, episodeNumber: null }),
      thread(12, 2, { comment_count: 7, recent_comments: 2, presence: 0, episodeNumber: 3 }),
    ]);
    expect(stats[1]).toEqual({
      recent: 9,
      presence: 3,
      comments: 35,
      href: "/anime/1/episode/9",
      label: "Ep 9 thread",
    });
    expect(stats[2].label).toBe("Ep 3 thread");
  });
});

describe("roomStatsByEpisode", () => {
  it("keys episode rooms and skips series boards", () => {
    const rooms = roomStatsByEpisode([
      thread(10, 1, { comment_count: 30, presence: 2, episodeNumber: 9 }),
      thread(11, 1, { episodeNumber: null }),
    ]);
    expect(rooms["1:9"]).toEqual({ presence: 2, comments: 30 });
    expect(Object.keys(rooms)).toHaveLength(1);
  });
});

describe("timelineMarks", () => {
  it("positions marks proportionally on the 25h axis, sorted by time", () => {
    // Axis start = now − 1h; an entry airing exactly now sits at 1/25.
    const marks = timelineMarks([sched(1, 9, at(11.5)), sched(2, 4, at(0))], NOW);
    expect(marks.map((m) => m.entry.anime.id)).toEqual([2, 1]);
    expect(marks[0].pct).toBeCloseTo(4, 5); // (1h)/(25h)
    expect(marks[1].pct).toBeCloseTo(50, 5); // (12.5h)/(25h)
    expect(marks.every((m) => m.lane === 0)).toBe(true);
    expect(timelineNowPct()).toBeCloseTo(4, 5);
  });

  it("stacks colliding air times into lanes and reuses lanes when full", () => {
    // Four shows in the same half hour: lanes 0,1,2 then back to the oldest.
    const marks = timelineMarks(
      [sched(1, 1, at(5)), sched(2, 1, at(5.1)), sched(3, 1, at(5.2)), sched(4, 1, at(5.3))],
      NOW,
    );
    expect(marks.map((m) => m.lane)).toEqual([0, 1, 2, 0]);
    // A later, clear entry drops back to lane 0.
    const spread = timelineMarks([sched(1, 1, at(2)), sched(2, 1, at(8))], NOW);
    expect(spread.map((m) => m.lane)).toEqual([0, 0]);
  });
});

describe("timelineTicks", () => {
  it("lays a half-hour grid with hour and midnight flags", () => {
    const ticks = timelineTicks(NOW);
    // 25h of half-hours, first tick aligned at or after axis start.
    expect(ticks.length).toBeGreaterThanOrEqual(50);
    expect(ticks.length).toBeLessThanOrEqual(51);
    for (const t of ticks) {
      expect([0, 30]).toContain(t.time.getMinutes());
      expect(t.isHour).toBe(t.time.getMinutes() === 0);
      expect(t.pct).toBeGreaterThanOrEqual(0);
      expect(t.pct).toBeLessThanOrEqual(100);
    }
    // A 25h window holds one midnight — or two when it starts dead on one.
    const midnights = ticks.filter((t) => t.isMidnight);
    expect([1, 2]).toContain(midnights.length);
    expect(midnights[0].time.getHours()).toBe(0);
  });
});

describe("pulseStats", () => {
  it("sums window comments and live presence", () => {
    const got = pulseStats([
      thread(10, 1, { recent_comments: 8, presence: 2 }),
      thread(11, 2, { recent_comments: 3, presence: 1 }),
    ]);
    expect(got).toEqual({ recent: 11, presence: 3 });
  });
});
