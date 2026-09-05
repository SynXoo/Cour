import { describe, expect, it } from "vitest";
import {
  anchorNumber,
  buildRanges,
  type Episode,
  episodeState,
  inRange,
  jumpTargets,
  latestAiredEpisode,
  needsPagination,
  nextUpNumber,
  progressSummary,
  rangeContaining,
  searchEpisodes,
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

  it("buckets by fifties, ascending, full-span labels on a partial top", () => {
    const ranges = buildRanges(list(1075)); // 1..1075
    expect(ranges).toHaveLength(22);
    expect(ranges[0]).toMatchObject({ lo: 1, hi: 50, label: "1–50", count: 50 });
    expect(ranges.at(-1)).toMatchObject({ lo: 1051, hi: 1100, label: "1051–1100", count: 25 });
  });

  it("omits empty buckets and counts sparse numbering", () => {
    const ranges = buildRanges([ep(3), ep(48), ep(120)]);
    expect(ranges.map((r) => r.label)).toEqual(["1–50", "101–150"]);
    expect(ranges[0].count).toBe(2);
  });

  it("folds episode 0 into the first range", () => {
    const ranges = buildRanges([ep(0), ep(1)]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ lo: 1, hi: 50, count: 2 });
  });
});

describe("inRange", () => {
  const r = buildRanges(list(60))[0]!; // first range is 1–50
  it("respects the bucket bounds inclusively", () => {
    expect(inRange(ep(1), r)).toBe(true);
    expect(inRange(ep(50), r)).toBe(true);
    expect(inRange(ep(51), r)).toBe(false);
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

describe("searchEpisodes", () => {
  const eps = [
    ep(1, null, "Romance Dawn"),
    ep(10, null, "The Weakest Man in the East"),
    ep(100, null, "Luffy in Danger"),
    ep(103, null, "Showdown"),
  ];

  it("says nothing until asked", () => {
    expect(searchEpisodes(eps, "")).toEqual([]);
    expect(searchEpisodes(eps, "   ")).toEqual([]);
  });

  it("puts the exact number first, then numbers starting with it", () => {
    expect(searchEpisodes(eps, "10").map((e) => e.number)).toEqual([10, 100, 103]);
    expect(searchEpisodes(eps, "1").map((e) => e.number)).toEqual([1, 10, 100, 103]);
    expect(searchEpisodes(eps, "103").map((e) => e.number)).toEqual([103]);
    expect(searchEpisodes(eps, "7")).toEqual([]);
  });

  it("searches titles, case-insensitively, for anything else", () => {
    expect(searchEpisodes(eps, "dawn").map((e) => e.number)).toEqual([1]);
    expect(searchEpisodes(eps, "THE").map((e) => e.number)).toEqual([10]);
    expect(searchEpisodes(eps, "nothing here")).toEqual([]);
  });

  it("caps the result list", () => {
    expect(searchEpisodes(list(40), "1", 3).map((e) => e.number)).toEqual([1, 10, 11]);
  });
});

describe("jumpTargets", () => {
  const now = Date.parse("2026-07-08T00:00:00Z");
  const iso = (offsetDays: number) => new Date(now + offsetDays * 86_400_000).toISOString();

  it("offers all three ways in for a viewer mid-show", () => {
    const eps = [ep(1, iso(-28)), ep(2, iso(-21)), ep(3, iso(-14)), ep(4, iso(-7)), ep(5, iso(6))];
    expect(jumpTargets(eps, 3, now)).toEqual([
      { key: "continue", label: "Continue · Ep 3", number: 3 },
      { key: "start", label: "Start · Ep 1", number: 1 },
      { key: "latest", label: "Latest · Ep 4", number: 4 },
    ]);
  });

  it("drops Latest when it is the episode you are already up to", () => {
    const eps = [ep(1, iso(-14)), ep(2, iso(-7)), ep(3, iso(6))];
    expect(jumpTargets(eps, 2, now).map((t) => t.key)).toEqual(["continue", "start"]);
  });

  it("drops a Continue that just means Start", () => {
    const eps = [ep(1, iso(-7)), ep(2, iso(-1))];
    expect(jumpTargets(eps, 1, now).map((t) => t.key)).toEqual(["start", "latest"]);
  });

  it("says Start, not Continue, for an untracked show", () => {
    const eps = [ep(1, iso(-7)), ep(2, iso(-1))];
    expect(jumpTargets(eps, null, now)).toEqual([
      { key: "start", label: "Start · Ep 1", number: 1 },
      { key: "latest", label: "Latest · Ep 2", number: 2 },
    ]);
  });

  it("collapses to one button on a one-episode show, and none on an empty one", () => {
    expect(jumpTargets([ep(1, iso(-7))], null, now)).toEqual([
      { key: "start", label: "Start · Ep 1", number: 1 },
    ]);
    expect(jumpTargets([], null, now)).toEqual([]);
  });
});

describe("anchorNumber", () => {
  const now = Date.parse("2026-07-08T00:00:00Z");
  const iso = (offsetDays: number) => new Date(now + offsetDays * 86_400_000).toISOString();

  it("parks on the next-up episode when there is one", () => {
    expect(anchorNumber([ep(1, iso(-7)), ep(2, iso(-1))], 2, now)).toBe(2);
  });

  it("falls back to the latest aired episode", () => {
    expect(anchorNumber([ep(1, iso(-7)), ep(2, iso(6))], null, now)).toBe(1);
    // A caught-up viewer has no next-up, so the newest one out it is.
    expect(anchorNumber([ep(1, iso(-7)), ep(2, iso(-1))], null, now)).toBe(2);
  });

  it("ignores a next-up number the list does not have", () => {
    expect(anchorNumber([ep(1, iso(-7))], 9, now)).toBe(1);
    expect(anchorNumber([], 1, now)).toBeNull();
  });
});
