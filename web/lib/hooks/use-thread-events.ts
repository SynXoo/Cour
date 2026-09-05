"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { components } from "@/lib/api/schema";

import { EMOJI_ORDER } from "@/lib/emoji";

export type Comment = components["schemas"]["Comment"];
type ReactionCount = components["schemas"]["ReactionCount"];
type ReactionUpdate = components["schemas"]["ReactionUpdate"];
type CommentDeleted = components["schemas"]["CommentDeleted"];
type PresenceUpdate = components["schemas"]["PresenceUpdate"];

// The paginated comment cache the ThreadView query holds — the SSE events fold
// straight into it so the live view and a fresh REST fetch stay byte-identical.
// Newest-first keyset pages (page 0 is the newest); ThreadView reverses the
// flattened pages back to arrival order to build the reply tree.
const commentsKey = (threadId: number) => ["comments", threadId] as const;

export type CommentPage = components["schemas"]["CommentList"];
export type CommentPages = InfiniteData<CommentPage>;

// EMOJI_ORDER mirrors the server's sortReactions, so a live-added emoji lands
// in the exact slot the next REST fetch would give it.

// ── Cache-merge helpers (pure; unit-tested) ─────────────────────────────────
//
// applyDeleted/applyReaction operate on a single page's flat list; mergeCreated
// and mapPages lift them over the paginated cache the query actually holds.

/**
 * Tombstone a comment in place — the REST shape of a deleted row is the same
 * flag + "[removed]" body, so the render path is unchanged. No-op (same
 * reference) when the id isn't held, so React skips a needless re-render.
 */
export function applyDeleted(list: Comment[], commentId: number): Comment[] {
  let changed = false;
  const next = list.map((c) => {
    if (c.id !== commentId) return c;
    changed = true;
    return { ...c, deleted: true, body: "[removed]" };
  });
  return changed ? next : list;
}

/**
 * Fold a reaction-count update into one comment. The event carries no ownership,
 * so the viewer's own `mine` flag is preserved; a count of 0 drops the emoji and
 * the survivors keep the canonical order.
 */
export function applyReaction(list: Comment[], u: ReactionUpdate): Comment[] {
  let changed = false;
  const next = list.map((c) => {
    if (c.id !== u.comment_id) return c;
    changed = true;
    const existing = c.reactions.find((r) => r.emoji === u.emoji);
    let reactions: ReactionCount[];
    if (existing) {
      reactions =
        u.count > 0
          ? c.reactions.map((r) => (r.emoji === u.emoji ? { ...r, count: u.count } : r))
          : c.reactions.filter((r) => r.emoji !== u.emoji);
    } else if (u.count > 0) {
      // First reaction of this emoji from someone else. We can't know it's ours;
      // if it were, our own REST call already refetched the authoritative `mine`.
      reactions = [...c.reactions, { emoji: u.emoji, count: u.count, mine: false }];
    } else {
      reactions = c.reactions;
    }
    reactions = [...reactions].sort(
      (a, b) => EMOJI_ORDER.indexOf(a.emoji) - EMOJI_ORDER.indexOf(b.emoji),
    );
    return { ...c, reactions };
  });
  return changed ? next : list;
}

/**
 * Fold a live comment into the paginated cache: replace it in place if we
 * already hold the id (the poster's own echo, a reconnect replay — idempotent),
 * otherwise prepend it to the newest page (page 0 is newest-first, and a live
 * arrival is always the newest). No-op before the first page has loaded.
 */
export function mergeCreated(data: CommentPages | undefined, c: Comment): CommentPages | undefined {
  if (!data || data.pages.length === 0) return data;
  if (data.pages.some((p) => p.data.some((x) => x.id === c.id))) {
    return {
      ...data,
      pages: data.pages.map((p) =>
        p.data.some((x) => x.id === c.id)
          ? { ...p, data: p.data.map((x) => (x.id === c.id ? c : x)) }
          : p,
      ),
    };
  }
  const [first, ...rest] = data.pages;
  return { ...data, pages: [{ ...first, data: [c, ...first.data] }, ...rest] };
}

/**
 * Apply a per-page list transform across the cache, preserving page references
 * where the transform was a no-op (so React skips untouched pages). Returns the
 * same cache reference when nothing changed.
 */
function mapPages(
  data: CommentPages | undefined,
  fn: (list: Comment[]) => Comment[],
): CommentPages | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((p) => {
    const next = fn(p.data);
    if (next === p.data) return p;
    changed = true;
    return { ...p, data: next };
  });
  return changed ? { ...data, pages } : data;
}

export const mergeDeleted = (data: CommentPages | undefined, commentId: number) =>
  mapPages(data, (list) => applyDeleted(list, commentId));

export const mergeReaction = (data: CommentPages | undefined, u: ReactionUpdate) =>
  mapPages(data, (list) => applyReaction(list, u));

function safeParse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

// ── The hook ────────────────────────────────────────────────────────────────

export type ThreadEvents = {
  /** Live readers connected to this thread (0 until the first presence event). */
  presence: number;
  /** True while the stream is down — the caller should poll to stay current. */
  degraded: boolean;
};

/**
 * Subscribes to a thread's SSE stream and merges the four named events into the
 * React Query cache. `onCreated` fires for every live `comment.created` (the
 * poster's own echo included) so the view can drive the "N new" pill / slide-in.
 * On stream error it flags `degraded` (EventSource keeps trying to reconnect)
 * and catches up with one invalidate once the connection returns.
 */
export function useThreadEvents(
  threadId: number,
  opts: { onCreated?: (c: Comment) => void; enabled?: boolean } = {},
): ThreadEvents {
  const { onCreated, enabled = true } = opts;
  const qc = useQueryClient();
  const [presence, setPresence] = useState(0);
  const [degraded, setDegraded] = useState(false);

  // Keep the latest callback without re-opening the stream when it changes.
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  });

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    // Same-origin path so the stream rides the Next /api/* rewrite (spike-proven
    // to stream unbuffered in dev and standalone); public thread, no token.
    const es = new EventSource(`/api/v1/threads/${threadId}/events`);
    let missedWhileDown = false;

    es.addEventListener("open", () => {
      setDegraded(false);
      if (missedWhileDown) {
        missedWhileDown = false;
        qc.invalidateQueries({ queryKey: commentsKey(threadId) });
      }
    });

    es.addEventListener("comment.created", (e) => {
      const c = safeParse<Comment>((e as MessageEvent).data);
      if (!c) return;
      qc.setQueryData<CommentPages>(commentsKey(threadId), (prev) => mergeCreated(prev, c));
      onCreatedRef.current?.(c);
    });

    es.addEventListener("comment.deleted", (e) => {
      const d = safeParse<CommentDeleted>((e as MessageEvent).data);
      if (!d) return;
      qc.setQueryData<CommentPages>(commentsKey(threadId), (prev) => mergeDeleted(prev, d.comment_id));
    });

    es.addEventListener("reaction.updated", (e) => {
      const u = safeParse<ReactionUpdate>((e as MessageEvent).data);
      if (!u) return;
      qc.setQueryData<CommentPages>(commentsKey(threadId), (prev) => mergeReaction(prev, u));
    });

    es.addEventListener("presence", (e) => {
      const p = safeParse<PresenceUpdate>((e as MessageEvent).data);
      if (p) setPresence(p.count);
    });

    es.addEventListener("error", () => {
      // EventSource reconnects on its own; flag degraded so the caller polls in
      // the meantime and remember to reconcile once we're back.
      missedWhileDown = true;
      setDegraded(true);
    });

    return () => es.close();
  }, [threadId, enabled, qc]);

  return { presence, degraded };
}
