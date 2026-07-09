import { describe, expect, it } from "vitest";
import {
  fallbackWallCovers,
  formatWatchTime,
  libraryTotal,
  nextListPage,
  profileTint,
} from "./profile";

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
  it("prefers the banner color", () => {
    expect(
      profileTint({ anime_id: 1, banner_image: null, cover_color: "#112233" }, [
        { cover_color: "#445566" },
      ]),
    ).toBe("#112233");
  });

  it("falls back to the first favorite that has a color", () => {
    expect(profileTint(null, [{ cover_color: null }, { cover_color: "#445566" }])).toBe("#445566");
  });

  it("is null with no banner and colorless favorites", () => {
    expect(profileTint(null, [{ cover_color: null }])).toBeNull();
  });

  it("skips a banner without a color rather than losing the favorite fallback", () => {
    expect(
      profileTint({ anime_id: 1, banner_image: "b.jpg", cover_color: null }, [
        { cover_color: "#445566" },
      ]),
    ).toBe("#445566");
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
