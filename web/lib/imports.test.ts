import { describe, expect, it } from "vitest";
import type { components } from "@/lib/api/schema";
import {
  buildResolutions,
  isActiveImport,
  partitionRows,
  summarizeCommit,
  type ImportRow,
  type RowPicks,
} from "./imports";

type AnimeSummary = components["schemas"]["AnimeSummary"];

function anime(id: number): AnimeSummary {
  return {
    id,
    slug: `anime-${id}`,
    title: `Anime ${id}`,
    title_english: null,
    cover_image: null,
    cover_color: null,
    format: "TV",
    status: "FINISHED",
    season: null,
    season_year: null,
    episodes_count: 12,
    average_score: null,
    popularity: 0,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
  };
}

function row(overrides: Partial<ImportRow> & { row_index: number }): ImportRow {
  return {
    title: `Row ${overrides.row_index}`,
    status: "watching",
    score: null,
    progress: 0,
    match: "id",
    anime: overrides.match === "review" ? null : anime(1000 + overrides.row_index),
    on_list: false,
    ...overrides,
  };
}

describe("isActiveImport", () => {
  it("keeps polling through pending/processing/committing only", () => {
    expect(isActiveImport("pending")).toBe(true);
    expect(isActiveImport("processing")).toBe(true);
    expect(isActiveImport("committing")).toBe(true);
    expect(isActiveImport("ready")).toBe(false);
    expect(isActiveImport("done")).toBe(false);
    expect(isActiveImport("failed")).toBe(false);
    expect(isActiveImport("superseded")).toBe(false);
  });
});

describe("partitionRows", () => {
  it("splits review rows from matched ones, keeping order", () => {
    const rows = [
      row({ row_index: 0 }),
      row({ row_index: 1, match: "review" }),
      row({ row_index: 2, match: "title" }),
      row({ row_index: 3, match: "review" }),
    ];
    const { review, matched } = partitionRows(rows);
    expect(review.map((r) => r.row_index)).toEqual([1, 3]);
    expect(matched.map((r) => r.row_index)).toEqual([0, 2]);
  });
});

describe("buildResolutions", () => {
  it("maps picks to ids, exclusions to null, ordered by row index", () => {
    const picks: RowPicks = new Map();
    picks.set(7, null);
    picks.set(2, anime(42));
    expect(buildResolutions(picks)).toEqual([
      { row_index: 2, anime_id: 42 },
      { row_index: 7, anime_id: null },
    ]);
  });

  it("is empty for no picks", () => {
    expect(buildResolutions(new Map())).toEqual([]);
  });
});

describe("summarizeCommit", () => {
  const rows = [
    row({ row_index: 0 }), // clean match
    row({ row_index: 1, on_list: true }), // preview-time conflict
    row({ row_index: 2, match: "review" }), // unresolved review
    row({ row_index: 3, match: "review" }), // review, resolved below
    row({ row_index: 4 }), // excluded below
  ];
  const picks: RowPicks = new Map();
  picks.set(3, anime(9));
  picks.set(4, null);

  it("merge keeps on-list rows and skips unresolved reviews", () => {
    expect(summarizeCommit(rows, picks, "merge")).toEqual({
      importing: 2, // row 0 + resolved review 3
      excluded: 1, // row 4
      unresolved: 1, // row 2
      mergeSkips: 1, // row 1
    });
  });

  it("overwrite imports the conflicting rows too", () => {
    expect(summarizeCommit(rows, picks, "overwrite")).toEqual({
      importing: 3,
      excluded: 1,
      unresolved: 1,
      mergeSkips: 0,
    });
  });

  it("an excluded on-list row counts as excluded, not merge-skipped", () => {
    const conflictOnly = [row({ row_index: 0, on_list: true })];
    const excluded: RowPicks = new Map([[0, null]]);
    expect(summarizeCommit(conflictOnly, excluded, "merge")).toEqual({
      importing: 0,
      excluded: 1,
      unresolved: 0,
      mergeSkips: 0,
    });
  });

  it("a re-matched conflict row imports even in merge mode", () => {
    // Picking a different target for an on-list row overrides the merge skip
    // client-side prediction — the pick is explicit user intent.
    const rows = [row({ row_index: 0, on_list: true })];
    const picks: RowPicks = new Map([[0, anime(5)]]);
    expect(summarizeCommit(rows, picks, "merge").importing).toBe(1);
  });
});
