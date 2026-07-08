import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "@/lib/api/schema";
import {
  applyDeleted,
  applyReaction,
  mergeCreated,
  mergeDeleted,
  mergeReaction,
  useThreadEvents,
  type Comment,
  type CommentPages,
} from "./use-thread-events";

type ReactionCount = components["schemas"]["ReactionCount"];

function comment(id: number, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    thread_id: 1,
    parent_id: null,
    author: { username: `user${id}`, avatar_url: null },
    body: `comment ${id}`,
    timestamp_seconds: null,
    has_spoilers: false,
    deleted: false,
    reactions: [],
    created_at: "2026-07-07T00:00:00Z",
    ...overrides,
  };
}

const react = (emoji: ReactionCount["emoji"], count: number, mine = false): ReactionCount => ({
  emoji,
  count,
  mine,
});

// Build a paginated cache: each argument is one page's data, newest page first,
// each page id-descending — the shape useInfiniteQuery holds for the thread.
const paged = (...pageData: Comment[][]): CommentPages => ({
  pages: pageData.map((data) => ({ data, next_cursor: null })),
  pageParams: pageData.map(() => 0),
});

describe("mergeCreated", () => {
  it("prepends a live comment to the newest page (page 0 is newest-first)", () => {
    const data = paged([comment(3), comment(2)], [comment(1)]);
    const next = mergeCreated(data, comment(4))!;
    expect(next.pages[0].data.map((c) => c.id)).toEqual([4, 3, 2]);
    expect(next.pages[1].data.map((c) => c.id)).toEqual([1]); // older page untouched
  });

  it("replaces in place when the id is already held — idempotent re-delivery", () => {
    const data = paged([comment(2)], [comment(1)]);
    const next = mergeCreated(data, comment(1, { body: "edited" }))!;
    expect(next.pages[1].data[0].body).toBe("edited");
    expect(next.pages[0].data.map((c) => c.id)).toEqual([2]); // not duplicated onto page 0
  });

  it("no-ops before any page has loaded", () => {
    expect(mergeCreated(undefined, comment(1))).toBeUndefined();
  });
});

describe("mergeDeleted / mergeReaction (page-lifted)", () => {
  it("tombstones a comment on its page and keeps untouched pages by reference", () => {
    const data = paged([comment(2)], [comment(1)]);
    const next = mergeDeleted(data, 1)!;
    expect(next.pages[1].data[0].deleted).toBe(true);
    expect(next.pages[1].data[0].body).toBe("[removed]");
    expect(next.pages[0]).toBe(data.pages[0]); // page without the id is not re-created
  });

  it("returns the same cache reference when the deleted id is absent everywhere", () => {
    const data = paged([comment(2)], [comment(1)]);
    expect(mergeDeleted(data, 99)).toBe(data);
  });

  it("folds a reaction update into the matching comment across pages", () => {
    const data = paged([comment(2)], [comment(1, { reactions: [react("heart", 1, true)] })]);
    const next = mergeReaction(data, { comment_id: 1, emoji: "heart", count: 5 })!;
    expect(next.pages[1].data[0].reactions).toEqual([react("heart", 5, true)]);
  });
});

describe("applyDeleted", () => {
  it("tombstones the matching comment into the REST shape", () => {
    const list = [comment(1), comment(2)];
    const next = applyDeleted(list, 1);
    const target = next.find((c) => c.id === 1)!;
    expect(target.deleted).toBe(true);
    expect(target.body).toBe("[removed]");
    expect(next.find((c) => c.id === 2)?.deleted).toBe(false);
  });

  it("returns the same reference when the id is absent (no needless re-render)", () => {
    const list = [comment(1)];
    expect(applyDeleted(list, 99)).toBe(list);
  });
});

describe("applyReaction", () => {
  it("updates an existing emoji's count while preserving the viewer's mine flag", () => {
    const list = [comment(1, { reactions: [react("heart", 1, true)] })];
    const next = applyReaction(list, { comment_id: 1, emoji: "heart", count: 4 });
    expect(next[0].reactions).toEqual([react("heart", 4, true)]);
  });

  it("adds a brand-new emoji (mine=false) and keeps the canonical order", () => {
    const list = [comment(1, { reactions: [react("laugh", 2)] })];
    const next = applyReaction(list, { comment_id: 1, emoji: "+1", count: 1 });
    // "+1" sorts before "laugh".
    expect(next[0].reactions.map((r) => r.emoji)).toEqual(["+1", "laugh"]);
    expect(next[0].reactions.find((r) => r.emoji === "+1")?.mine).toBe(false);
  });

  it("drops an emoji whose count fell to zero", () => {
    const list = [comment(1, { reactions: [react("heart", 1, true), react("fire", 2)] })];
    const next = applyReaction(list, { comment_id: 1, emoji: "heart", count: 0 });
    expect(next[0].reactions.map((r) => r.emoji)).toEqual(["fire"]);
  });

  it("is a no-op (same reference) for a zero count on an emoji not present", () => {
    const list = [comment(1, { reactions: [react("fire", 1)] })];
    const next = applyReaction(list, { comment_id: 1, emoji: "cry", count: 0 });
    expect(next[0].reactions).toEqual([react("fire", 1)]);
  });

  it("returns the same reference when the comment id is unknown", () => {
    const list = [comment(1)];
    expect(applyReaction(list, { comment_id: 42, emoji: "fire", count: 3 })).toBe(list);
  });

  it("leaves other comments untouched", () => {
    const list = [comment(1, { reactions: [react("fire", 1)] }), comment(2)];
    const next = applyReaction(list, { comment_id: 2, emoji: "heart", count: 1 });
    expect(next[0].reactions).toEqual([react("fire", 1)]);
    expect(next[1].reactions).toEqual([react("heart", 1)]);
  });
});

// ── The subscription hook (fake EventSource) ────────────────────────────────

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    const ev = { data: data === undefined ? "" : JSON.stringify(data) };
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

describe("useThreadEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tracks presence and degrades on error, recovering on reconnect", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useThreadEvents(7), { wrapper: wrapper(client) });
    const es = FakeEventSource.instances.at(-1)!;

    expect(result.current.presence).toBe(0);
    expect(result.current.degraded).toBe(false);

    act(() => es.emit("presence", { count: 5 }));
    await waitFor(() => expect(result.current.presence).toBe(5));

    // Stream drops → degraded so the caller starts polling.
    act(() => es.emit("error"));
    await waitFor(() => expect(result.current.degraded).toBe(true));

    // Reconnect clears the flag and reconciles missed events with one invalidate.
    const invalidate = vi.spyOn(client, "invalidateQueries");
    act(() => es.emit("open"));
    await waitFor(() => expect(result.current.degraded).toBe(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["comments", 7] });
  });

  it("merges comment.created into the paginated cache and calls onCreated", async () => {
    const client = new QueryClient();
    client.setQueryData<CommentPages>(["comments", 7], paged([comment(1, { body: "first" })]));
    const onCreated = vi.fn();
    renderHook(() => useThreadEvents(7, { onCreated }), { wrapper: wrapper(client) });
    const es = FakeEventSource.instances.at(-1)!;

    act(() => es.emit("comment.created", comment(2, { body: "live" })));

    await waitFor(() => {
      const data = client.getQueryData<CommentPages>(["comments", 7]);
      expect(data?.pages[0].data.map((c) => c.id)).toEqual([2, 1]); // newest prepended
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("closes the stream on unmount", () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => useThreadEvents(7), { wrapper: wrapper(client) });
    const es = FakeEventSource.instances.at(-1)!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
