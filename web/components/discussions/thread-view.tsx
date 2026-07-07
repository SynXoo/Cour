"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { CommentItem, groupReplies, LiveCommentsContext, type Comment } from "./comment-item";

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
  const [sort, setSort] = useState<"time" | "timeline">("time");

  // Live layer: comments arriving via SSE that landed while the reader was
  // scrolled up (→ the "N new" pill) and the set that should slide in.
  const [newCount, setNewCount] = useState(0);
  const [liveIds, setLiveIds] = useState<Set<number>>(() => new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    setNewCount(0);
    requestAnimationFrame(() => {
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
    });
  }, []);

  const onCreated = useCallback(
    (c: Comment) => {
      setLiveIds((prev) => {
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
      const mine = user != null && c.author.username === user.username;
      // Following live at the bottom (or it's our own post): let it stream in.
      // Reading further up: don't yank scroll — surface a pill instead.
      if (mine || atBottomRef.current) scrollToBottom();
      else setNewCount((n) => n + 1);
    },
    [user, scrollToBottom],
  );

  const { presence, degraded } = useThreadEvents(threadId, { onCreated });

  const { data, isLoading } = useQuery({
    queryKey: ["comments", threadId],
    // The SSE stream keeps the cache current; when it drops, poll so the thread
    // still moves until it reconnects.
    refetchInterval: degraded ? 15_000 : false,
    queryFn: async () => {
      const res = await browserApi.GET("/threads/{threadId}/comments", {
        params: { path: { threadId } },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });

  // A visible bottom sentinel means the newest comment is on screen: the reader
  // is caught up, so new arrivals stream in rather than banking into the pill.
  useEffect(() => {
    const el = bottomRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        atBottomRef.current = entry.isIntersecting;
        if (entry.isIntersecting) setNewCount(0);
      },
      { rootMargin: "0px 0px 96px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const comments = data ?? [];
  const roots = comments.filter((c) => c.parent_id == null);
  const descendants = comments.filter((c) => c.parent_id != null);

  const anyTimestamps = comments.some((c) => c.timestamp_seconds != null);
  const timeline =
    sort === "timeline"
      ? [...comments]
          .filter((c) => c.timestamp_seconds != null && !c.deleted)
          .sort((a, b) => a.timestamp_seconds! - b.timestamp_seconds!)
      : null;

  function refresh() {
    qc.invalidateQueries({ queryKey: ["comments", threadId] });
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
        {allowTimestamps && anyTimestamps ? (
          <div className="flex gap-1.5" role="group" aria-label="Comment ordering">
            <Button
              size="sm"
              className="h-11 md:h-7"
              variant={sort === "time" ? "secondary" : "ghost"}
              onClick={() => setSort("time")}
            >
              Chronological
            </Button>
            <Button
              size="sm"
              className="h-11 md:h-7"
              variant={sort === "timeline" ? "secondary" : "ghost"}
              onClick={() => setSort("timeline")}
            >
              Episode timeline
            </Button>
          </div>
        ) : (
          <span />
        )}
        {presence >= 2 && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {presence} here now
          </span>
        )}
      </div>

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
            {roots.map((root) => (
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

      <div ref={bottomRef} aria-hidden className="h-px" />

      {newCount > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-live="polite"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 rounded-full border border-primary/40 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:bottom-8"
        >
          ↓ {newCount} new comment{newCount === 1 ? "" : "s"}
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
    <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
      {replyTo && (
        <p className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          <span className="truncate">
            Replying to <strong>@{replyTo.author.username}</strong>: {replyTo.body.slice(0, 80)}
          </span>
          <button type="button" onClick={clearReply} className="shrink-0 px-1 py-1 underline">
            cancel
          </button>
        </p>
      )}
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={replyTo ? "Write your reply…" : "Share your thoughts…"}
        aria-label="Comment"
        className="font-sans"
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
