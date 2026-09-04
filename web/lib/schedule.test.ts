import { describe, expect, it } from "vitest";
import type { ScheduleEntry } from "@/lib/api/client";
import { applyLens, groupByDay, popularCutoff } from "./schedule";

function entry(id: number, airing: string, popularity = 1000): ScheduleEntry {
  return {
    episode: 3,
    airing_at: airing,
    anime: {
      id,
      slug: `a-${id}`,
      title: `Title ${id}`,
      title_english: null,
      cover_image: null,
      cover_color: null,
      format: "TV",
      status: "RELEASING",
      season: "SUMMER",
      season_year: 2026,
      episodes_count: 12,
      average_score: null,
      popularity,
      genres: [],
      next_airing_at: airing,
      next_airing_episode: 3,
    },
  };
}

// A fixed local "now": Friday 2026-09-04 at 18:00.
const now = new Date(2026, 8, 4, 18, 0);
const at = (dayOffset: number, hour: number) =>
  new Date(2026, 8, 4 + dayOffset, hour).toISOString();

describe("groupByDay", () => {
  it("makes seven days starting today, labels the first two, keeps empties", () => {
    const days = groupByDay([entry(1, at(0, 21)), entry(2, at(2, 9)), entry(3, at(2, 8))], now);
    expect(days).toHaveLength(7);
    expect(days[0].label).toBe("Today");
    expect(days[1].label).toBe("Tomorrow");
    expect(days[1].entries).toEqual([]);
    expect(days[0].entries.map((e) => e.anime.id)).toEqual([1]);
    // Same-day rows come soonest first regardless of input order.
    expect(days[2].entries.map((e) => e.anime.id)).toEqual([3, 2]);
  });

  it("drops entries outside the window", () => {
    const days = groupByDay([entry(1, at(9, 12)), entry(2, at(-1, 12))], now);
    expect(days.every((d) => d.entries.length === 0)).toBe(true);
  });
});

describe("popularCutoff / applyLens", () => {
  const week = [
    entry(1, at(0, 20), 9000),
    entry(2, at(0, 21), 5000),
    entry(3, at(1, 20), 4000),
    entry(4, at(1, 21), 300),
    entry(5, at(2, 20), 200),
    entry(6, at(3, 20), 100),
    // A second episode of show 1 must not count twice toward the cutoff.
    entry(1, at(5, 20), 9000),
  ];

  it("cuts at the top third of distinct shows", () => {
    // 6 shows → ceil(6/3) = 2 → the 2nd-highest popularity (5000).
    expect(popularCutoff(week)).toBe(5000);
    expect(popularCutoff([])).toBe(0);
  });

  it("applies each lens", () => {
    expect(applyLens(week, "popular", new Set()).map((e) => e.anime.id)).toEqual([1, 2, 1]);
    expect(applyLens(week, "mine", new Set([4, 6])).map((e) => e.anime.id)).toEqual([4, 6]);
    expect(applyLens(week, "all", new Set())).toHaveLength(7);
  });
});
