import { describe, expect, it } from "vitest";
import {
  accentSwatches,
  completionRate,
  criticVerdict,
  dropRate,
  fallbackWallCovers,
  fillEraGaps,
  formatWatchTime,
  libraryTotal,
  meanEpisodesPerShow,
  nextListPage,
  peakEra,
  profileTint,
  scaleVerdict,
  watchTimeFraming,
} from "./profile";

const counts = (over: Partial<Record<"watching" | "completed" | "planning" | "paused" | "dropped", number>> = {}) => ({
  watching: 0,
  completed: 0,
  planning: 0,
  paused: 0,
  dropped: 0,
  ...over,
});

const bias = (userMean: number, communityMean: number) => ({
  user_mean: userMean,
  community_mean: communityMean,
  sample_size: 20,
});

describe("formatWatchTime", () => {
  it("uses days+hours above a day", () => {
    expect(formatWatchTime(13_200)).toBe("9d 4h"); // 9*1440 + 4*60
  });

  it("uses hours+minutes below a day", () => {
    expect(formatWatchTime(272)).toBe("4h 32m");
  });

  it("uses bare minutes below an hour", () => {
    expect(formatWatchTime(51)).toBe("51m");
  });

  it("is null when nothing has been watched", () => {
    expect(formatWatchTime(0)).toBeNull();
  });
});

describe("profileTint", () => {
  it("prefers the owner's explicit accent over everything", () => {
    expect(
      profileTint("#ff0000", { anime_id: 1, banner_image: null, cover_color: "#112233" }, [
        { cover_color: "#445566" },
      ]),
    ).toBe("#ff0000");
  });

  it("prefers the banner color when no accent is picked", () => {
    expect(
      profileTint(null, { anime_id: 1, banner_image: null, cover_color: "#112233" }, [
        { cover_color: "#445566" },
      ]),
    ).toBe("#112233");
  });

  it("falls back to the first favorite that has a color", () => {
    expect(profileTint(null, null, [{ cover_color: null }, { cover_color: "#445566" }])).toBe(
      "#445566",
    );
  });

  it("is null with no banner and colorless favorites", () => {
    expect(profileTint(null, null, [{ cover_color: null }])).toBeNull();
  });

  it("skips a banner without a color rather than losing the favorite fallback", () => {
    expect(
      profileTint(null, { anime_id: 1, banner_image: "b.jpg", cover_color: null }, [
        { cover_color: "#445566" },
      ]),
    ).toBe("#445566");
  });
});

describe("accentSwatches", () => {
  it("keeps shelf order, drops colorless, dedupes across case", () => {
    expect(
      accentSwatches([
        { id: 1, cover_color: "#AABBCC" },
        { id: 2, cover_color: null },
        { id: 3, cover_color: "#aabbcc" }, // same hex, other case
        { id: 4, cover_color: "#123456" },
      ]),
    ).toEqual(["#aabbcc", "#123456"]);
  });

  it("caps the swatch row", () => {
    const favorites = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      cover_color: `#00000${i.toString(16)}`,
    }));
    expect(accentSwatches(favorites, 8)).toHaveLength(8);
  });
});

describe("criticVerdict", () => {
  it("names the harsh end", () => {
    expect(criticVerdict(bias(6.8, 8.1)).label).toBe("Harsh critic");
    expect(criticVerdict(bias(7.5, 8.0)).label).toBe("Tough grader");
  });

  it("treats a fraction of a point as agreement, in both directions", () => {
    expect(criticVerdict(bias(7.9, 8.0)).label).toBe("In step with the crowd");
    expect(criticVerdict(bias(8.2, 8.0)).label).toBe("In step with the crowd");
  });

  it("names the generous end", () => {
    expect(criticVerdict(bias(8.6, 8.0)).label).toBe("Generous");
    expect(criticVerdict(bias(9.5, 8.0)).label).toBe("Easy to please");
  });

  it("reports a signed delta", () => {
    expect(criticVerdict(bias(6.8, 8.1)).delta).toBeCloseTo(-1.3, 5);
    expect(criticVerdict(bias(9.0, 8.0)).delta).toBeCloseTo(1.0, 5);
  });

  // Only the difference is read, so these means are synthetic on purpose:
  // subtracting from zero is the one way to land on an edge exactly, since
  // 7.65 - 8.0 is -0.34999999999999964 and would silently miss it.
  it("puts the band edges on the tough/generous side, not the middle", () => {
    expect(criticVerdict(bias(0, 0.35)).label).toBe("Tough grader"); // exactly -0.35
    expect(criticVerdict(bias(0.35, 0)).label).toBe("Generous"); // exactly +0.35
    expect(criticVerdict(bias(0, 1)).label).toBe("Harsh critic"); // exactly -1.0
    expect(criticVerdict(bias(1, 0)).label).toBe("Easy to please"); // exactly +1.0
  });
});

describe("scaleVerdict", () => {
  it("reads the spread", () => {
    expect(scaleVerdict(0.4)).toBe("Plays it safe");
    expect(scaleVerdict(1.2)).toBe("Balanced range");
    expect(scaleVerdict(2.3)).toBe("Uses the whole scale");
  });
});

describe("completionRate / dropRate", () => {
  it("ignores planning and watching — neither has settled", () => {
    const c = counts({ completed: 8, dropped: 2, paused: 0, planning: 50, watching: 30 });
    expect(completionRate(c)).toBeCloseTo(0.8, 5);
    expect(dropRate(c)).toBeCloseTo(0.2, 5);
  });

  it("counts paused against the finisher", () => {
    const c = counts({ completed: 2, dropped: 1, paused: 1 });
    expect(completionRate(c)).toBeCloseTo(0.5, 5);
  });

  it("is null when nothing has settled", () => {
    expect(completionRate(counts({ planning: 10, watching: 3 }))).toBeNull();
    expect(dropRate(counts())).toBeNull();
  });
});

describe("meanEpisodesPerShow", () => {
  it("divides, and refuses to divide by zero", () => {
    expect(meanEpisodesPerShow(599, 21)).toBeCloseTo(28.52, 2);
    expect(meanEpisodesPerShow(0, 0)).toBeNull();
  });
});

describe("watchTimeFraming", () => {
  it("frames a real library as a slice of a year and a stack of films", () => {
    const f = watchTimeFraming(13_700)!;
    expect(f.films).toBe(114);
    expect(f.yearPercent).toBeCloseTo(2.606, 2);
  });

  it("stays quiet below a single film", () => {
    expect(watchTimeFraming(119)).toBeNull();
    expect(watchTimeFraming(0)).toBeNull();
  });
});

describe("fillEraGaps", () => {
  it("zero-fills the hole so an 18-year gap reads as one", () => {
    const filled = fillEraGaps([
      { year: 2007, count: 1 },
      { year: 2024, count: 1 },
      { year: 2026, count: 1 },
    ]);
    expect(filled).toHaveLength(20); // 2007..2026 inclusive
    expect(filled[0]).toEqual({ year: 2007, count: 1 });
    expect(filled[1]).toEqual({ year: 2008, count: 0 });
    expect(filled.at(-1)).toEqual({ year: 2026, count: 1 });
    expect(filled.filter((f) => f.count > 0)).toHaveLength(3);
  });

  it("is empty for an empty history, and a single year stays single", () => {
    expect(fillEraGaps([])).toEqual([]);
    expect(fillEraGaps([{ year: 2020, count: 4 }])).toEqual([{ year: 2020, count: 4 }]);
  });
});

describe("peakEra", () => {
  it("names the runaway year", () => {
    expect(
      peakEra([
        { year: 2019, count: 9 },
        { year: 2020, count: 2 },
      ]),
    ).toBe(2019);
  });

  it("stays quiet on a tie, and on an empty history", () => {
    expect(
      peakEra([
        { year: 2019, count: 3 },
        { year: 2020, count: 3 },
      ]),
    ).toBeNull();
    expect(peakEra([])).toBeNull();
    expect(peakEra([{ year: 2019, count: 0 }])).toBeNull();
  });

  it("ignores the zeros that fillEraGaps invents", () => {
    expect(peakEra(fillEraGaps([{ year: 2007, count: 1 }, { year: 2024, count: 5 }]))).toBe(2024);
  });
});

describe("fallbackWallCovers", () => {
  it("leads with favorites, fills from watching, dedupes, drops coverless", () => {
    const covers = fallbackWallCovers(
      [
        { id: 1, cover_image: "f1.jpg" },
        { id: 2, cover_image: null },
      ],
      [
        { anime: { id: 1, cover_image: "f1.jpg" } }, // dupe
        { anime: { id: 3, cover_image: "w3.jpg" } },
      ],
    );
    expect(covers.map((c) => c.id)).toEqual([1, 3]);
  });

  it("caps the wall", () => {
    const favorites = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      cover_image: `c${i}.jpg`,
    }));
    expect(fallbackWallCovers(favorites, [], 14)).toHaveLength(14);
  });
});

describe("libraryTotal / nextListPage", () => {
  it("sums the five statuses", () => {
    expect(
      libraryTotal({ watching: 2, completed: 3, planning: 1, paused: 0, dropped: 1 }),
    ).toBe(7);
  });

  it("pages until the total is covered, then stops", () => {
    expect(nextListPage({ page: 1, per_page: 50, total: 120 })).toBe(2);
    expect(nextListPage({ page: 3, per_page: 50, total: 120 })).toBeNull();
    expect(nextListPage({ page: 1, per_page: 50, total: 50 })).toBeNull();
    expect(nextListPage({ page: 1, per_page: 50, total: 0 })).toBeNull();
  });
});
