import { describe, expect, it } from "vitest";
import { signalChips, youLines } from "./trending";

describe("signalChips", () => {
  it("orders by signal weight, skips zeros, pluralizes, caps", () => {
    const chips = signalChips({
      comments: 14,
      list_adds: 22,
      completed: 1,
      favorites: 0,
      reviews: 1,
      scored: 3,
    });
    expect(chips.map((c) => c.label)).toEqual(["1 review", "14 comments", "1 finished it"]);
    expect(signalChips({ comments: 0, list_adds: 0, completed: 0, favorites: 0, reviews: 0, scored: 0 })).toEqual([]);
  });
});

describe("youLines", () => {
  it("is empty for anonymous callers or nothing personal", () => {
    expect(youLines(null)).toEqual([]);
    expect(youLines({ status: null, followees: [], followees_count: 0, shared_genres: [] })).toEqual([]);
  });

  it("names followees, adds +N overflow, then status, then taste", () => {
    expect(
      youLines({
        status: "watching",
        followees: ["rin", "mika", "noodle"],
        followees_count: 5,
        shared_genres: ["Action", "Drama"],
      }),
    ).toEqual([
      "@rin, @mika, @noodle +2 have it on their list",
      "You're watching it",
      "Action · Drama — your kind of show",
    ]);
    expect(youLines({ status: null, followees: ["rin"], followees_count: 1, shared_genres: [] })).toEqual([
      "@rin has it on their list",
    ]);
  });
});
