import { describe, expect, it } from "vitest";
import {
  buildRanges,
  DEFAULT_ORDER,
  type Episode,
  episodeState,
  inRange,
  latestAiredEpisode,
  needsPagination,
  nextUpNumber,
  orderEpisodes,
  progressSummary,
  rangeContaining,
} from "./episodes";

const ep = (number: number, airing_at: string | null = null, title: string | null = null): Episode => ({
  number,
  title,
  airing_at,
});

const list = (n: number, from = 1): Episode[] =>
  Array.from({ length: n }, (_, i) => ep(from + i));

describe("needsPagination", () => {
  it("is false at or below the threshold, true above", () => {
    expect(needsPagination(list(1))).toBe(false);
    expect(needsPagination(list(50))).toBe(false);
    expect(needsPagination(list(51))).toBe(true);
  });
});

describe("buildRanges", () => {
  it("returns one range for a small show", () => {
    const ranges = buildRanges(list(12));
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ id: "1", lo: 1, hi: 50, label: "1–50", count: 12 });
  });

  it("buckets by fifties, newest range first, full-span labels on a partial top", () => {
    const ranges = buildRanges(list(1075)); // 1..1075
    expect(ranges).toHaveLength(22);
    expect(ranges[0]).toMatchObject({ lo: 1051, hi: 1100, label: "1051–1100", count: 25 });
    expect(ranges.at(-1)).toMatchObject({ lo: 1, hi: 50, label: "1–50", count: 50 });
  });

  it("omits empty buckets and counts sparse numbering", () => {
    const ranges = buildRanges([ep(3), ep(48), ep(120)]);
    expect(ranges.map((r) => r.label)).toEqual(["101–150", "1–50"]);
    expect(ranges[1].count).toBe(2);
  });

  it("folds episode 0 into the first range", () => {
    const ranges = buildRanges([ep(0), ep(1)]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ lo: 1, hi: 50, count: 2 });
  });
});

describe("inRange", () => {
  const r = buildRanges(list(60)).at(-1)!; // last (oldest) range is 1–50
  it("respects the bucket bounds inclusively", () => {
    expect(inRange(ep(1), r)).toBe(true);
    expect(inRange(ep(50), r)).toBe(true);
    expect(inRange(ep(51), r)).toBe(false);
  });
});

describe("orderEpisodes", () => {
  it("sorts descending by default and ascending on demand", () => {
    const eps = [ep(2), ep(1), ep(3)];
    expect(orderEpisodes(eps, "desc").map((e) => e.number)).toEqual([3, 2, 1]);
    expect(orderEpisodes(eps, "asc").map((e) => e.number)).toEqual([1, 2, 3]);
    expect(DEFAULT_ORDER).toBe("desc");
  });

  it("does not mutate the input", () => {
    const eps = [ep(2), ep(1)];
    orderEpisodes(eps, "asc");
    expect(eps.map((e) => e.number)).toEqual([2, 1]);
  });
});

describe("latestAiredEpisode", () => {
  const now = Date.parse("2026-07-08T00:00:00Z");
  const iso = (offsetDays: number) => new Date(now + offsetDays * 86_400_000).toISOString();

  it("returns null for an empty list", () => {
    expect(latestAiredEpisode([], now)).toBeNull();
  });

  it("picks the most recently aired episode, ignoring the future", () => {
    const eps = [ep(1, iso(-14)), ep(2, iso(-7)), ep(3, iso(-1)), ep(4, iso(6))];
    expect(latestAiredEpisode(eps, now)?.number).toBe(3);
  });

  it("falls back to the highest number when nothing has aired", () => {
    const eps = [ep(1, iso(2)), ep(2, iso(9))];
    expect(latestAiredEpisode(eps, now)?.number).toBe(2);
  });

  it("falls back to the highest number when air dates are unknown", () => {
    const eps = [ep(1), ep(3), ep(2)];
    expect(latestAiredEpisode(eps, now)?.number).toBe(3);
  });

  it("mixes known and unknown dates — aired past wins over a numbered-but-dateless later ep", () => {
    const eps = [ep(1, iso(-1)), ep(2, null)];
    expect(latestAiredEpisode(eps, now)?.number).toBe(1);
  });
});

describe("you are here", () => {
  it("picks the lowest episode past the viewer's progress", () => {
    expect(nextUpNumber(list(12), 7)).toBe(8);
    expect(nextUpNumber(list(12), 0)).toBe(1);
    expect(nextUpNumber(list(12), 12)).toBeNull();
    // Gaps in numbering: the next *existing* one, not progress + 1.
    expect(nextUpNumber([ep(1), ep(2), ep(5)], 2)).toBe(5);
    expect(nextUpNumber([], 3)).toBeNull();
  });

  it("classifies rows against progress and the next-up number", () => {
    expect(episodeState(3, 7, 8)).toBe("watched");
    expect(episodeState(7, 7, 8)).toBe("watched");
    expect(episodeState(8, 7, 8)).toBe("next");
    expect(episodeState(9, 7, 8)).toBe("ahead");
    expect(episodeState(1, null, null)).toBeNull();
    expect(episodeState(1, undefined, null)).toBeNull();
  });

  it("finds the range page an episode lives on", () => {
    const ranges = buildRanges(list(120));
    expect(rangeContaining(ranges, 73)?.label).toBe("51–100");
    expect(rangeContaining(ranges, 120)?.label).toBe("101–150");
    expect(rangeContaining(ranges, null)).toBeUndefined();
    expect(rangeContaining(ranges, 500)).toBeUndefined();
  });

  it("writes the progress line as a place, not a chart", () => {
    expect(progressSummary(7, 12, 8)).toBe("You're on episode 7 of 12 · 5 to go");
    expect(progressSummary(7, null, 8)).toBe("You're on episode 7");
    expect(progressSummary(12, 12, null)).toBe("You've watched all 12 episodes");
    expect(progressSummary(0, 12, 1)).toBe("Not started yet — episode 1 is up next");
    expect(progressSummary(0, null, null)).toBe("Not started yet");
  });
});
