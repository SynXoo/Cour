"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { components } from "@/lib/api/schema";

export type Comment = components["schemas"]["Comment"];
type Emoji = components["schemas"]["Emoji"];
type ReactionCount = components["schemas"]["ReactionCount"];
type ReactionUpdate = components["schemas"]["ReactionUpdate"];
type CommentDeleted = components["schemas"]["CommentDeleted"];
type PresenceUpdate = components["schemas"]["PresenceUpdate"];

// The comment list the ThreadView query caches — the SSE events fold straight
// into this so the live view and a fresh REST fetch stay byte-identical.
const commentsKey = (threadId: number) => ["comments", threadId] as const;

// Mirrors comment-item.tsx's render order and the server's sortReactions, so a
// live-added emoji lands in the exact slot the next REST fetch would give it.
const EMOJI_ORDER: Emoji[] = ["+1", "heart", "laugh", "surprise", "cry", "fire"];

// ── Cache-merge helpers (pure; unit-tested) ─────────────────────────────────

/**
 * Append a live comment, or replace it if we already hold that id (the poster's
 * own echo, a reconnect replay). Idempotent so double-delivery never doubles a
 * row.
 */
export function applyCreated(list: Comment[], c: Comment): Comment[] {
  const i = list.findIndex((x) => x.id === c.id);
  if (i === -1) return [...list, c];
  const next = list.slice();
  next[i] = c;
  return next;
}

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
      qc.setQueryData<Comment[]>(commentsKey(threadId), (prev) => applyCreated(prev ?? [], c));
      onCreatedRef.current?.(c);
    });

    es.addEventListener("comment.deleted", (e) => {
      const d = safeParse<CommentDeleted>((e as MessageEvent).data);
      if (!d) return;
      qc.setQueryData<Comment[]>(commentsKey(threadId), (prev) =>
        applyDeleted(prev ?? [], d.comment_id),
      );
    });

    es.addEventListener("reaction.updated", (e) => {
      const u = safeParse<ReactionUpdate>((e as MessageEvent).data);
      if (!u) return;
      qc.setQueryData<Comment[]>(commentsKey(threadId), (prev) => applyReaction(prev ?? [], u));
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
