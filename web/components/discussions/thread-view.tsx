"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { CommentItem, groupReplies, type Comment } from "./comment-item";

export function ThreadView({
  threadId,
  allowTimestamps,
}: {
  threadId: number;
  allowTimestamps: boolean;
}) {
  const { status } = useSession();
  const qc = useQueryClient();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sort, setSort] = useState<"time" | "timeline">("time");

  const { data, isLoading } = useQuery({
    queryKey: ["comments", threadId],
    queryFn: async () => {
      const res = await browserApi.GET("/threads/{threadId}/comments", {
        params: { path: { threadId } },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });

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

      {allowTimestamps && anyTimestamps && (
        <div className="flex gap-1" role="group" aria-label="Comment ordering">
          <Button
            size="sm"
            variant={sort === "time" ? "secondary" : "ghost"}
            onClick={() => setSort("time")}
          >
            Chronological
          </Button>
          <Button
            size="sm"
            variant={sort === "timeline" ? "secondary" : "ghost"}
            onClick={() => setSort("timeline")}
          >
            Episode timeline
          </Button>
        </div>
      )}

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
          <button type="button" onClick={clearReply} className="shrink-0 underline">
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
            className="w-24 font-mono text-sm"
          />
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={spoilers} onCheckedChange={(v) => setSpoilers(v === true)} />
          Spoilers
        </label>
        <Button size="sm" onClick={post} disabled={posting || body.trim() === ""} className="ml-auto">
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
