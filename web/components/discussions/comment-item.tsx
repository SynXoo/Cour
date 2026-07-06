"use client";

import Link from "next/link";
import { SpoilerGuard } from "@/components/spoiler-guard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { useSession } from "@/lib/auth/session";
import { formatTimestamp } from "@/lib/timestamp";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export type Comment = components["schemas"]["Comment"];
export type Emoji = components["schemas"]["Emoji"];

const EMOJI_GLYPHS: Record<Emoji, string> = {
  "+1": "👍",
  heart: "❤️",
  laugh: "😂",
  surprise: "😮",
  cry: "😢",
  fire: "🔥",
};

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
  const isMine = user?.username === comment.author.username;

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

  async function react(emoji: Emoji, on: boolean) {
    if (status !== "authed") {
      toast("Sign in to react");
      return;
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
    <li className={depth > 0 ? "ml-4 border-l border-border/60 pl-4 sm:ml-6" : ""}>
      <article className="space-y-2 py-3">
        <header className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/users/${comment.author.username}`}
            className="flex items-center gap-1.5 font-medium hover:text-primary"
          >
            <Avatar className="h-6 w-6 text-[10px]">
              {comment.author.avatar_url && <AvatarImage src={comment.author.avatar_url} alt="" />}
              <AvatarFallback>{comment.author.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            @{comment.author.username}
          </Link>
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
            {visibleReactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => react(r.emoji, !r.mine)}
                aria-pressed={r.mine}
                aria-label={`${r.emoji} reaction, ${r.count}`}
                className={`inline-flex min-h-11 items-center rounded-full border px-2 text-xs transition-colors md:min-h-0 md:py-0.5 ${
                  r.mine
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border/60 text-muted-foreground hover:border-primary/40"
                }`}
              >
                {EMOJI_GLYPHS[r.emoji]} {r.count}
              </button>
            ))}
            <ReactionPicker onPick={(emoji) => react(emoji, true)} />
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
 * Splits a flat descendant list into direct replies of parentId, each
 * bundled with its own descendants (preserving chronological order).
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
    } else {
      // Orphaned (ancestor outside this slice) — attach to the last group
      // rather than dropping it.
      if (groups.length === 0) {
        index.set(c.id, 0);
        groups.push([c]);
      } else {
        index.set(c.id, groups.length - 1);
        groups[groups.length - 1].push(c);
      }
    }
  }
  return groups;
}

function ReactionPicker({ onPick }: { onPick: (emoji: Emoji) => void }) {
  return (
    <details className="group relative">
      <summary
        className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full border border-dashed border-border/60 px-2 text-xs text-muted-foreground hover:border-primary/40 md:min-h-0 md:min-w-0 md:py-0.5"
        aria-label="Add reaction"
      >
        +
      </summary>
      <div className="absolute z-10 mt-1 flex max-w-[calc(100vw-2rem)] flex-wrap gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-md">
        {(Object.keys(EMOJI_GLYPHS) as Emoji[]).map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React ${emoji}`}
            className="flex min-h-11 min-w-11 items-center justify-center rounded text-base hover:bg-accent md:min-h-0 md:min-w-0 md:p-1"
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
