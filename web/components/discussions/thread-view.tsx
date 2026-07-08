"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useThreadEvents } from "@/lib/hooks/use-thread-events";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import {
  CommentItem,
  CommentsIndexContext,
  groupReplies,
  jumpToComment,
  LiveCommentsContext,
  SpoilerShieldContext,
  type Comment,
} from "./comment-item";

type Sort = "newest" | "oldest" | "top" | "timeline";

const SORT_LABELS: Record<Exclude<Sort, "timeline">, string> = {
  newest: "Newest",
  oldest: "Oldest",
  top: "Top",
};

export function ThreadView({
  threadId,
  allowTimestamps,
}: {
  threadId: number;
  allowTimestamps: boolean;
}) {
  const { status, user } = useSession();
  const qc = useQueryClient();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sort, setSort] = useState<Sort>("newest");

  // Live layer: comments arriving via SSE that landed while the reader was
  // elsewhere (→ the "N new" pill) and the set that should slide in.
  const [newCount, setNewCount] = useState(0);
  const [liveIds, setLiveIds] = useState<Set<number>>(() => new Set());
  const lastLiveIdRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const atAnchorRef = useRef(true);

  // Identity changes with sort are fine: useThreadEvents holds the callback in
  // a ref, so the SSE stream never re-opens over this.
  const onCreated = useCallback(
    (c: Comment) => {
      setLiveIds((prev) => {
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
      lastLiveIdRef.current = c.id;
      const mine = user != null && c.author.username === user.username;
      // In the date sorts new arrivals land at a known edge, so a reader parked
      // there just watches them stream in. Top/timeline scatter arrivals by
      // score/stamp — never yank scroll there. Your own comment always wins:
      // jump to it wherever it sorted.
      const following = (sort === "newest" || sort === "oldest") && atAnchorRef.current;
      if (mine || following) jumpToComment(c.id);
      else setNewCount((n) => n + 1);
    },
    [user, sort],
  );

  const { presence, degraded } = useThreadEvents(threadId, { onCreated });

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["comments", threadId],
    // The SSE stream keeps the cache current; when it drops, poll so the thread
    // still moves until it reconnects. Refetch re-pulls every loaded page, so
    // "load older" history survives a post/react/reconnect invalidate.
    refetchInterval: degraded ? 15_000 : false,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await browserApi.GET("/threads/{threadId}/comments", {
        params: {
          path: { threadId },
          // pageParam 0 = newest page; otherwise it's the older page's cursor.
          query: pageParam > 0 ? { before_id: pageParam } : {},
        },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  // A visible sentinel at the arrival edge (top for newest, bottom for oldest)
  // means the reader is caught up: new comments stream in rather than banking
  // into the pill.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        atAnchorRef.current = entry.isIntersecting;
        if (entry.isIntersecting) setNewCount(0);
      },
      { rootMargin: "96px 0px 96px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sort]);

  // Pages arrive newest-first (each id-descending); flatten and reverse to
  // arrival order (id ASC) so the reply-tree builder always meets a parent
  // before its children.
  const comments = (data?.pages.flatMap((p) => p.data) ?? []).reverse();
  const loadedIds = new Set(comments.map((c) => c.id));
  const byId = new Map(comments.map((c) => [c.id, c]));
  const descendants = comments.filter((c) => c.parent_id != null);
  // A reply whose parent sits on an older, not-yet-loaded page can't be traced
  // to a loaded root, so it would silently vanish. Promote such orphans to
  // display roots (comment-item marks them with an "earlier comment" stub);
  // real roots keep their id-ASC order since `comments` is sorted.
  const displayRoots = comments.filter((c) => c.parent_id == null || !loadedIds.has(c.parent_id));

  // Subtree reply counts, for the Top tiebreak.
  const replyCount = new Map<number, number>();
  {
    const rootOf = new Map<number, number>();
    for (const c of comments) {
      if (c.parent_id == null || !loadedIds.has(c.parent_id)) {
        rootOf.set(c.id, c.id); // a real root, or an orphan standing in for one
        continue;
      }
      const r = rootOf.get(c.parent_id);
      if (r == null) continue;
      rootOf.set(c.id, r);
      replyCount.set(r, (replyCount.get(r) ?? 0) + 1);
    }
  }
  const heat = (c: Comment) => c.reactions.reduce((n, r) => n + r.count, 0);
  const sortedRoots =
    sort === "oldest"
      ? displayRoots
      : sort === "top"
        ? // Most-reacted first; ties go to the busiest conversation, then newest.
          [...displayRoots].sort(
            (a, b) =>
              heat(b) - heat(a) ||
              (replyCount.get(b.id) ?? 0) - (replyCount.get(a.id) ?? 0) ||
              b.id - a.id,
          )
        : [...displayRoots].reverse(); // newest (also the fallback while sort === "timeline")

  const anyTimestamps = comments.some((c) => c.timestamp_seconds != null);
  const timeline =
    sort === "timeline"
      ? [...comments]
          .filter((c) => c.timestamp_seconds != null && !c.deleted)
          .sort((a, b) => a.timestamp_seconds! - b.timestamp_seconds!)
      : null;
  const anchorTop = sort === "newest";

  function refresh() {
    qc.invalidateQueries({ queryKey: ["comments", threadId] });
  }

  function showLatest() {
    setNewCount(0);
    if (lastLiveIdRef.current != null) jumpToComment(lastLiveIdRef.current);
  }

  return (
    <div className="space-y-4">
      {status === "authed" ? (
        <Composer
          threadId={threadId}
          allowTimestamps={allowTimestamps}
          replyTo={replyTo}
          clearReply={() => setReplyTo(null)}
          onPosted={refresh}
        />
      ) : status === "anon" ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-sm text-muted-foreground">
          <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
            Sign in
          </Link>{" "}
          to join the discussion.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort comments">
          {(Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[]).map((s) => (
            <Button
              key={s}
              size="sm"
              className="h-11 md:h-7"
              variant={sort === s ? "secondary" : "ghost"}
              onClick={() => setSort(s)}
            >
              {SORT_LABELS[s]}
            </Button>
          ))}
          {allowTimestamps && anyTimestamps && (
            <Button
              size="sm"
              className="h-11 md:h-7"
              variant={sort === "timeline" ? "secondary" : "ghost"}
              onClick={() => setSort("timeline")}
            >
              Timeline
            </Button>
          )}
        </div>
        {presence >= 2 && (
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {presence} here now
          </span>
        )}
      </div>

      {/* Honest scope note: with older pages unloaded, every sort — Top and
          Timeline included — ranks only the comments currently in view. */}
      {hasNextPage && !isLoading && (
        <p className="text-xs text-muted-foreground">
          Showing the {comments.length} most recent {comments.length === 1 ? "comment" : "comments"} —
          every sort covers just these. Load older below to include earlier ones.
        </p>
      )}

      {anchorTop && <div ref={anchorRef} aria-hidden className="h-px" />}

      <CommentsIndexContext.Provider value={byId}>
        <LiveCommentsContext.Provider value={liveIds}>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
          ) : comments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No comments yet — first!
            </p>
          ) : timeline ? (
            <ul className="divide-y divide-border/60">
              {timeline.map((c) => (
                <CommentItem key={c.id} comment={c} replies={[]} onReply={setReplyTo} />
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-border/60">
              {sortedRoots.map((root) => (
                <CommentItem
                  key={root.id}
                  comment={root}
                  replies={groupReplies(descendants, root.id)}
                  onReply={setReplyTo}
                />
              ))}
            </ul>
          )}
        </LiveCommentsContext.Provider>
      </CommentsIndexContext.Provider>

      {!anchorTop && <div ref={anchorRef} aria-hidden className="h-px" />}

      {hasNextPage && !isLoading && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-8"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading…" : "Load older comments"}
          </Button>
        </div>
      )}

      {newCount > 0 && (
        <button
          type="button"
          onClick={showLatest}
          aria-live="polite"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 rounded-full border border-primary/40 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:bottom-8"
        >
          {anchorTop ? "↑ " : sort === "oldest" ? "↓ " : ""}
          {newCount} new comment{newCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function Composer({
  threadId,
  allowTimestamps,
  replyTo,
  clearReply,
  onPosted,
}: {
  threadId: number;
  allowTimestamps: boolean;
  replyTo: Comment | null;
  clearReply: () => void;
  onPosted: () => void;
}) {
  const [body, setBody] = useState("");
  const [stamp, setStamp] = useState("");
  const [spoilers, setSpoilers] = useState(false);
  const [posting, setPosting] = useState(false);
  const shield = useContext(SpoilerShieldContext);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Picking "Reply" far down the thread must visibly do something: bring the
  // composer to the reader and put the caret in it.
  useEffect(() => {
    if (!replyTo) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    boxRef.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
    textRef.current?.focus({ preventScroll: true });
  }, [replyTo]);

  async function post() {
    const trimmed = body.trim();
    if (!trimmed) return;

    let timestampSeconds: number | null = null;
    if (allowTimestamps && stamp.trim() !== "") {
      timestampSeconds = parseTimestamp(stamp);
      if (timestampSeconds == null) {
        toast.error("Timestamp must look like 12:34");
        return;
      }
    }

    setPosting(true);
    try {
      const res = await browserApi.POST("/threads/{threadId}/comments", {
        params: { path: { threadId } },
        body: {
          body: trimmed,
          parent_id: replyTo?.id ?? null,
          timestamp_seconds: timestampSeconds,
          has_spoilers: spoilers,
        },
      });
      if (res.error) {
        toast.error(res.error.error.message);
        return;
      }
      setBody("");
      setStamp("");
      setSpoilers(false);
      clearReply();
      onPosted();
    } finally {
      setPosting(false);
    }
  }

  return (
    <div ref={boxRef} className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
      {replyTo && (
        <p
          key={replyTo.id}
          className="reply-chip flex items-center justify-between gap-2 rounded border-l-2 border-primary/60 bg-muted px-2 py-1 text-xs text-muted-foreground"
        >
          <span className="truncate">
            Replying to <strong className="text-foreground/80">@{replyTo.author.username}</strong>:{" "}
            {/* Quoting a hidden comment in the composer would leak it. */}
            {replyTo.has_spoilers || shield ? <em>spoiler-marked comment</em> : replyTo.body.slice(0, 80)}
          </span>
          <button type="button" onClick={clearReply} className="shrink-0 px-1 py-1 underline">
            cancel
          </button>
        </p>
      )}
      <Textarea
        ref={textRef}
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") post();
        }}
        placeholder={replyTo ? "Write your reply…" : "Share your thoughts…"}
        aria-label="Comment"
      />
      <div className="flex flex-wrap items-center gap-3">
        {allowTimestamps && !replyTo && (
          <Input
            value={stamp}
            onChange={(e) => setStamp(e.target.value)}
            placeholder="12:34"
            aria-label="Moment timestamp (mm:ss)"
            className="h-11 w-24 font-mono text-sm md:h-8"
          />
        )}
        <label className="flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground md:min-h-0">
          <Checkbox checked={spoilers} onCheckedChange={(v) => setSpoilers(v === true)} />
          Spoilers
        </label>
        <Button
          size="sm"
          onClick={post}
          disabled={posting || body.trim() === ""}
          className="ml-auto h-11 px-4 md:h-7 md:px-2.5"
        >
          {posting ? "Posting…" : replyTo ? "Reply" : "Comment"}
        </Button>
      </div>
      {allowTimestamps && !replyTo && stamp.trim() !== "" && parseTimestamp(stamp) != null && (
        <p className="text-xs text-muted-foreground">
          Anchored to {formatTimestamp(parseTimestamp(stamp)!)} in the episode.
        </p>
      )}
    </div>
  );
}
