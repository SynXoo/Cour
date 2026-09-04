import { describe, expect, it } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import { compactCount, filterGems, gemGroup, gemReason } from "./gems";

function anime(id: number, format: AnimeSummary["format"], popularity = 1500, score: number | null = 84): AnimeSummary {
  return {
    id,
    slug: `a-${id}`,
    title: `T${id}`,
    title_english: null,
    cover_image: null,
    cover_color: null,
    format,
    status: "FINISHED",
    season: null,
    season_year: null,
    episodes_count: null,
    average_score: score,
    popularity,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
  };
}

describe("gems helpers", () => {
  it("groups formats into the three chips", () => {
    expect(gemGroup("TV")).toBe("tv");
    expect(gemGroup("MOVIE")).toBe("movies");
    expect(gemGroup("OVA")).toBe("shorts");
    expect(gemGroup("SPECIAL")).toBe("shorts");
    expect(gemGroup(null)).toBe("tv");
  });

  it("filters by group and passes everything for all", () => {
    const list = [anime(1, "TV"), anime(2, "MOVIE"), anime(3, "ONA")];
    expect(filterGems(list, "shorts").map((a) => a.id)).toEqual([3]);
    expect(filterGems(list, "all")).toHaveLength(3);
  });

  it("formats counts and the gem reason", () => {
    expect(compactCount(987)).toBe("987");
    expect(compactCount(1234)).toBe("1.2k");
    expect(compactCount(2000)).toBe("2k");
    expect(compactCount(12345)).toBe("12k");
    expect(gemReason(anime(1, "TV", 1234, 84))).toBe("★ 84 · only 1.2k on lists");
    expect(gemReason(anime(1, "TV", 500, null))).toBe("unrated · only 500 on lists");
  });
});
