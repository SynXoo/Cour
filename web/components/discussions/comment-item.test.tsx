import { describe, expect, it } from "vitest";
import { type Comment, groupReplies } from "./comment-item";

function c(id: number, parentId: number | null): Comment {
  return {
    id,
    thread_id: 7,
    parent_id: parentId,
    author: { username: `user${id}`, avatar_url: null },
    body: `comment ${id}`,
    timestamp_seconds: null,
    has_spoilers: false,
    deleted: false,
    reactions: [],
    created_at: "2026-07-07T00:00:00Z",
  };
}

const ids = (groups: Comment[][]) => groups.map((g) => g.map((x) => x.id));

describe("groupReplies", () => {
  it("bundles each direct reply with its own descendants", () => {
    // root 1 → 2 → 4, and 1 → 3
    const flat = [c(2, 1), c(3, 1), c(4, 2)];
    expect(ids(groupReplies(flat, 1))).toEqual([
      [2, 4],
      [3],
    ]);
  });

  it("keeps other roots' subtrees out (reply-under-every-comment regression)", () => {
    // Two roots (1, 2); a single reply to root 1. Grouping for root 2 must be
    // empty — the old orphan-adoption glued foreign replies onto every root.
    const flat = [c(3, 1)];
    expect(ids(groupReplies(flat, 1))).toEqual([[3]]);
    expect(groupReplies(flat, 2)).toEqual([]);
  });

  it("separates interleaved subtrees of different roots", () => {
    // root 1 → 3 → 5, root 2 → 4, arriving interleaved by id.
    const flat = [c(3, 1), c(4, 2), c(5, 3)];
    expect(ids(groupReplies(flat, 1))).toEqual([[3, 5]]);
    expect(ids(groupReplies(flat, 2))).toEqual([[4]]);
  });

  it("returns no groups for a leaf", () => {
    expect(groupReplies([], 1)).toEqual([]);
  });
});
