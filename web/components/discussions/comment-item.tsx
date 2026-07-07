"use client";

import Link from "next/link";
import { createContext, useContext, useRef, useState, type CSSProperties } from "react";
import { SpoilerGuard } from "@/components/spoiler-guard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { useSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/timestamp";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export type Comment = components["schemas"]["Comment"];
export type Emoji = components["schemas"]["Emoji"];

/**
 * Ids of comments that arrived live this session — those items play the
 * slide-in animation once on mount. Provided by ThreadView; empty by default so
 * the initial batch never animates.
 */
export const LiveCommentsContext = createContext<Set<number>>(new Set());

/**
 * Every comment in the thread by id, for reply→parent lookups (the quote chip).
 * Provided by ThreadView.
 */
export const CommentsIndexContext = createContext<Map<number, Comment>>(new Map());

const EMOJI_GLYPHS: Record<Emoji, string> = {
  "+1": "👍",
  heart: "❤️",
  laugh: "😂",
  surprise: "😮",
  cry: "😢",
  fire: "🔥",
};

/** Stable hue per username so the same person is the same color everywhere. */
function hueFor(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Scrolls a comment into view and flashes it so the eye lands. Used by the
 * reply quote chips, the "N new" pill, and posting (jump to your own comment).
 * No-ops when the id isn't rendered (e.g. timeline sort hides untimestamped
 * comments). Deferred a frame so a comment merged into the cache this tick has
 * been committed to the DOM by the time we look for it.
 */
export function jumpToComment(id: number) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${id}`);
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
      el.classList.remove("comment-flash");
      void el.offsetWidth; // restart the animation when re-jumping to the same comment
      el.classList.add("comment-flash");
    });
  });
}

export function CommentItem({
  comment,
  replies,
  onReply,
  depth = 0,
}: {
  comment: Comment;
  replies: Comment[][];
  onReply: (parent: Comment) => void;
  depth?: number;
}) {
  const { status, user } = useSession();
  const qc = useQueryClient();
  const liveIds = useContext(LiveCommentsContext);
  const byId = useContext(CommentsIndexContext);
  const isMine = user?.username === comment.author.username;
  const isLive = liveIds.has(comment.id);
  const parent = comment.parent_id != null ? byId.get(comment.parent_id) : undefined;

  // The reaction that just landed, keyed so re-reacting replays the animation.
  const [burst, setBurst] = useState<{ emoji: Emoji; at: "chip" | "picker"; key: number } | null>(
    null,
  );
  const burstSeq = useRef(0);

  async function remove() {
    const res = await browserApi.DELETE("/comments/{commentId}", {
      params: { path: { commentId: comment.id } },
    });
    if (res.error) {
      toast.error(res.error.error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["comments", comment.thread_id] });
  }

  async function react(emoji: Emoji, on: boolean, from: "chip" | "picker" = "chip") {
    if (status !== "authed") {
      toast("Sign in to react");
      return;
    }
    // Fire the tapback immediately — waiting for the server would kill the fun.
    if (on) {
      burstSeq.current += 1;
      setBurst({ emoji, at: from, key: burstSeq.current });
    }
    const res = on
      ? await browserApi.PUT("/comments/{commentId}/reactions/{emoji}", {
          params: { path: { commentId: comment.id, emoji } },
        })
      : await browserApi.DELETE("/comments/{commentId}/reactions/{emoji}", {
          params: { path: { commentId: comment.id, emoji } },
        });
    if (res.error) {
      toast.error(res.error.error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["comments", comment.thread_id] });
  }

  const visibleReactions = comment.reactions.filter((r) => r.count > 0);

  return (
    <li
      id={`comment-${comment.id}`}
      className={cn(
        depth > 0 && "ml-4 border-l border-border/60 pl-4 sm:ml-6",
        isLive && "comment-enter",
      )}
    >
      <article
        className={cn(
          "space-y-2 rounded-xl py-3 transition-colors",
          // Your own comments carry the tinted-bubble identity; everyone else
          // stays flat with a whisper of hover.
          isMine
            ? "my-2 border border-primary/25 bg-primary/10 px-3"
            : "hover:bg-muted/20",
        )}
      >
        <header className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/users/${comment.author.username}`}
            className="flex items-center gap-1.5 font-medium hover:text-primary"
          >
            <Avatar className="h-6 w-6 text-[10px]">
              {comment.author.avatar_url && <AvatarImage src={comment.author.avatar_url} alt="" />}
              <AvatarFallback
                className="avatar-hue"
                style={{ "--avatar-hue": hueFor(comment.author.username) } as CSSProperties}
              >
                {comment.author.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            @{comment.author.username}
          </Link>
          {isMine && (
            <span className="rounded-full border border-primary/30 px-1.5 text-[10px] uppercase tracking-wide text-primary">
              you
            </span>
          )}
          {comment.timestamp_seconds != null && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs text-primary">
              @ {formatTimestamp(comment.timestamp_seconds)}
            </span>
          )}
          <time dateTime={comment.created_at} className="text-xs text-muted-foreground">
            {new Date(comment.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </header>

        {parent && (
          <button
            type="button"
            onClick={() => jumpToComment(parent.id)}
            className="flex w-fit max-w-full items-baseline gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            aria-label={`Jump to @${parent.author.username}'s comment`}
          >
            <span aria-hidden className="shrink-0">
              ↩
            </span>
            <span className="shrink-0 font-medium">@{parent.author.username}</span>
            <span className="truncate">
              {parent.deleted ? (
                <em>[removed]</em>
              ) : parent.has_spoilers ? (
                <em>spoiler-marked comment</em>
              ) : (
                parent.body
              )}
            </span>
          </button>
        )}

        {comment.deleted ? (
          <p className="text-sm italic text-muted-foreground">[removed]</p>
        ) : (
          <SpoilerGuard active={comment.has_spoilers}>
            <p className="whitespace-pre-line font-sans text-sm leading-relaxed text-foreground/90">
              {comment.body}
            </p>
          </SpoilerGuard>
        )}

        {!comment.deleted && (
          <footer className="flex flex-wrap items-center gap-1.5">
            {visibleReactions.map((r) => {
              const popping = burst?.at === "chip" && burst.emoji === r.emoji;
              return (
                <button
                  key={popping ? `${r.emoji}-${burst.key}` : r.emoji}
                  type="button"
                  onClick={() => react(r.emoji, !r.mine)}
                  aria-pressed={r.mine}
                  aria-label={`${r.emoji} reaction, ${r.count}`}
                  className={cn(
                    "relative inline-flex min-h-11 items-center rounded-full border px-2 text-xs transition-colors md:min-h-0 md:py-0.5",
                    popping && "tapback-pop",
                    r.mine
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border/60 text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {EMOJI_GLYPHS[r.emoji]} {r.count}
                  {popping && (
                    <span
                      key={burst.key}
                      aria-hidden
                      className="tapback-burst text-base"
                      onAnimationEnd={() => setBurst(null)}
                    >
                      {EMOJI_GLYPHS[burst.emoji]}
                    </span>
                  )}
                </button>
              );
            })}
            <ReactionPicker
              onPick={(emoji) => {
                // A first-of-its-kind reaction has no chip yet — burst from the
                // picker; otherwise the chip pops.
                const hasChip = visibleReactions.some((r) => r.emoji === emoji);
                react(emoji, true, hasChip ? "chip" : "picker");
              }}
              burst={burst?.at === "picker" ? burst : null}
              onBurstEnd={() => setBurst(null)}
            />
            <Button variant="ghost" size="sm" className="h-11 md:h-7" onClick={() => onReply(comment)}>
              Reply
            </Button>
            {isMine && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 text-muted-foreground md:h-7"
                onClick={remove}
              >
                Delete
              </Button>
            )}
          </footer>
        )}
      </article>

      {replies.length > 0 && (
        <ul>
          {replies.map(([child, ...grandchildren]) => (
            <CommentItem
              key={child.id}
              comment={child}
              replies={groupReplies(grandchildren, child.id)}
              onReply={onReply}
              depth={Math.min(depth + 1, 3)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Splits a flat, chronologically-ordered descendant list into direct replies
 * of parentId, each bundled with its own descendants. Comments whose ancestry
 * doesn't reach parentId (other subtrees) are left out — the API orders by id
 * and a parent's id is always smaller than its replies', so every ancestor is
 * seen before its children.
 */
export function groupReplies(flat: Comment[], parentId: number): Comment[][] {
  const groups: Comment[][] = [];
  const index = new Map<number, number>(); // comment id -> group index

  for (const c of flat) {
    if (c.parent_id === parentId) {
      index.set(c.id, groups.length);
      groups.push([c]);
    } else if (c.parent_id != null && index.has(c.parent_id)) {
      const g = index.get(c.parent_id)!;
      index.set(c.id, g);
      groups[g].push(c);
    }
  }
  return groups;
}

function ReactionPicker({
  onPick,
  burst,
  onBurstEnd,
}: {
  onPick: (emoji: Emoji) => void;
  burst: { emoji: Emoji; key: number } | null;
  onBurstEnd: () => void;
}) {
  return (
    <details className="group relative">
      <summary
        className="relative inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full border border-dashed border-border/60 px-2 text-xs text-muted-foreground hover:border-primary/40 md:min-h-0 md:min-w-0 md:py-0.5"
        aria-label="Add reaction"
      >
        +
        {burst && (
          <span
            key={burst.key}
            aria-hidden
            className="tapback-burst text-base"
            onAnimationEnd={onBurstEnd}
          >
            {EMOJI_GLYPHS[burst.emoji]}
          </span>
        )}
      </summary>
      <div className="absolute z-10 mt-1 flex max-w-[calc(100vw-2rem)] flex-wrap gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-md">
        {(Object.keys(EMOJI_GLYPHS) as Emoji[]).map((emoji, i) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React ${emoji}`}
            style={{ "--i": i } as CSSProperties}
            className="picker-item flex min-h-11 min-w-11 items-center justify-center rounded text-base hover:bg-accent md:min-h-0 md:min-w-0 md:p-1"
            onClick={(e) => {
              onPick(emoji);
              (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
            }}
          >
            {EMOJI_GLYPHS[emoji]}
          </button>
        ))}
      </div>
    </details>
  );
}
