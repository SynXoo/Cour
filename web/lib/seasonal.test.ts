import { describe, expect, it } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import {
  arrangeAnime,
  collectGenres,
  collectWeekdays,
  filterAnime,
  formatGroupOf,
  hasActiveFilters,
  isGroupedView,
  parseFormatGroup,
  parseSort,
  parseWeekday,
  sortAnime,
  weekdayOf,
} from "./seasonal";

// Local-noon ISO for a given Y/M/D, so the derived weekday is stable across
// the runner's timezone (noon never crosses a day boundary in real offsets).
const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

function mk(over: Partial<AnimeSummary> & Pick<AnimeSummary, "id">): AnimeSummary {
  return {
    slug: `anime-${over.id}`,
    title: `Title ${over.id}`,
    title_english: null,
    cover_image: null,
    cover_color: null,
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: null,
    popularity: 0,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
    ...over,
  };
}

describe("param parsing", () => {
  it("falls back to the default sort for unknown values", () => {
    expect(parseSort("score")).toBe("score");
    expect(parseSort("nonsense")).toBe("popularity");
    expect(parseSort(null)).toBe("popularity");
  });

  it("validates format group and weekday params", () => {
    expect(parseFormatGroup("movies")).toBe("movies");
    expect(parseFormatGroup("tv")).toBe("tv");
    expect(parseFormatGroup("bogus")).toBeNull();
    expect(parseWeekday("friday")).toBe("friday");
    expect(parseWeekday("Funday")).toBeNull();
    expect(parseWeekday(null)).toBeNull();
  });
});

describe("formatGroupOf", () => {
  it("buckets formats into the three chart groups", () => {
    expect(formatGroupOf("TV")).toBe("tv");
    expect(formatGroupOf("TV_SHORT")).toBe("tv");
    expect(formatGroupOf("MOVIE")).toBe("movies");
    expect(formatGroupOf("OVA")).toBe("special");
    expect(formatGroupOf("MUSIC")).toBe("special");
    expect(formatGroupOf(null)).toBe("special");
    expect(formatGroupOf(undefined)).toBe("special");
  });
});

describe("weekdayOf", () => {
  it("maps an airing instant to a Monday-first weekday name", () => {
    expect(weekdayOf(iso(2026, 7, 6))).toBe("monday"); // 2026-07-06 is a Monday
    expect(weekdayOf(iso(2026, 7, 10))).toBe("friday");
    expect(weekdayOf(iso(2026, 7, 12))).toBe("sunday");
  });

  it("returns null for missing or invalid instants", () => {
    expect(weekdayOf(null)).toBeNull();
    expect(weekdayOf(undefined)).toBeNull();
    expect(weekdayOf("not-a-date")).toBeNull();
  });
});

describe("filterAnime", () => {
  const list = [
    mk({ id: 1, format: "TV", genres: ["Action", "Comedy"], next_airing_at: iso(2026, 7, 10) }), // Fri
    mk({ id: 2, format: "MOVIE", genres: ["Drama"], next_airing_at: null }),
    mk({ id: 3, format: "OVA", genres: ["Action"], next_airing_at: iso(2026, 7, 6) }), // Mon
  ];

  it("filters by format group", () => {
    expect(filterAnime(list, { format: "tv", genre: null, day: null }).map((a) => a.id)).toEqual([1]);
    expect(filterAnime(list, { format: "special", genre: null, day: null }).map((a) => a.id)).toEqual([3]);
  });

  it("filters by genre membership", () => {
    expect(filterAnime(list, { format: null, genre: "Action", day: null }).map((a) => a.id)).toEqual([1, 3]);
    expect(filterAnime(list, { format: null, genre: "Drama", day: null }).map((a) => a.id)).toEqual([2]);
  });

  it("filters by airing weekday", () => {
    expect(filterAnime(list, { format: null, genre: null, day: "friday" }).map((a) => a.id)).toEqual([1]);
    expect(filterAnime(list, { format: null, genre: null, day: "monday" }).map((a) => a.id)).toEqual([3]);
  });

  it("combines filters (AND)", () => {
    expect(
      filterAnime(list, { format: "tv", genre: "Action", day: "friday" }).map((a) => a.id),
    ).toEqual([1]);
    expect(
      filterAnime(list, { format: "tv", genre: "Drama", day: null }).map((a) => a.id),
    ).toEqual([]);
  });
});

describe("sortAnime", () => {
  it("orders by popularity descending by default", () => {
    const list = [mk({ id: 1, popularity: 10 }), mk({ id: 2, popularity: 90 }), mk({ id: 3, popularity: 50 })];
    expect(sortAnime(list, "popularity").map((a) => a.id)).toEqual([2, 3, 1]);
  });

  it("orders by score with unscored titles last", () => {
    const list = [
      mk({ id: 1, average_score: 70, popularity: 5 }),
      mk({ id: 2, average_score: null, popularity: 100 }),
      mk({ id: 3, average_score: 88, popularity: 5 }),
    ];
    expect(sortAnime(list, "score").map((a) => a.id)).toEqual([3, 1, 2]);
  });

  it("orders by title case-insensitively", () => {
    const list = [
      mk({ id: 1, title: "Zombie Land" }),
      mk({ id: 2, title: "apple" }),
      mk({ id: 3, title: "Bocchi" }),
    ];
    expect(sortAnime(list, "title").map((a) => a.id)).toEqual([2, 3, 1]);
  });

  it("orders by newest via id descending", () => {
    const list = [mk({ id: 5 }), mk({ id: 200 }), mk({ id: 42 })];
    expect(sortAnime(list, "newest").map((a) => a.id)).toEqual([200, 42, 5]);
  });

  it("orders by weekday (Mon-first) with null airings last", () => {
    const list = [
      mk({ id: 1, next_airing_at: iso(2026, 7, 10) }), // Fri
      mk({ id: 2, next_airing_at: null }),
      mk({ id: 3, next_airing_at: iso(2026, 7, 6) }), // Mon
    ];
    expect(sortAnime(list, "weekday").map((a) => a.id)).toEqual([3, 1, 2]);
  });

  it("does not mutate the input array", () => {
    const list = [mk({ id: 1, popularity: 1 }), mk({ id: 2, popularity: 2 })];
    const before = list.map((a) => a.id);
    sortAnime(list, "popularity");
    expect(list.map((a) => a.id)).toEqual(before);
  });
});

describe("arrangeAnime", () => {
  it("filters before sorting", () => {
    const list = [
      mk({ id: 1, format: "TV", popularity: 10 }),
      mk({ id: 2, format: "MOVIE", popularity: 99 }),
      mk({ id: 3, format: "TV", popularity: 50 }),
    ];
    expect(
      arrangeAnime(list, "popularity", { format: "tv", genre: null, day: null }).map((a) => a.id),
    ).toEqual([3, 1]);
  });
});

describe("view mode", () => {
  const none = { format: null, genre: null, day: null };
  it("groups only for the default sort with no filters", () => {
    expect(isGroupedView("popularity", none)).toBe(true);
    expect(isGroupedView("score", none)).toBe(false);
    expect(isGroupedView("popularity", { ...none, genre: "Action" })).toBe(false);
  });

  it("detects active filters", () => {
    expect(hasActiveFilters(none)).toBe(false);
    expect(hasActiveFilters({ ...none, day: "friday" })).toBe(true);
  });
});

describe("chip sources", () => {
  it("collects a sorted union of genres", () => {
    const list = [
      mk({ id: 1, genres: ["Comedy", "Action"] }),
      mk({ id: 2, genres: ["Action", "Drama"] }),
    ];
    expect(collectGenres(list)).toEqual(["Action", "Comedy", "Drama"]);
  });

  it("collects present weekdays in Monday-first order", () => {
    const list = [
      mk({ id: 1, next_airing_at: iso(2026, 7, 12) }), // Sun
      mk({ id: 2, next_airing_at: iso(2026, 7, 6) }), // Mon
      mk({ id: 3, next_airing_at: null }),
    ];
    expect(collectWeekdays(list)).toEqual(["monday", "sunday"]);
  });
});
