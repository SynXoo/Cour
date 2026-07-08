"use client";

import { ThumbsUpIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { SpoilerGuard } from "@/components/spoiler-guard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { useSession } from "@/lib/auth/session";

export type Review = components["schemas"]["Review"];

export function ReviewCard({
  review,
  clampBody = true,
}: {
  review: Review;
  clampBody?: boolean;
}) {
  return (
    <article className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link
          href={`/users/${review.author.username}`}
          className="flex items-center gap-2 hover:text-primary"
        >
          <Avatar className="h-7 w-7 text-xs">
            {review.author.avatar_url && <AvatarImage src={review.author.avatar_url} alt="" />}
            <AvatarFallback>{review.author.username.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">@{review.author.username}</span>
        </Link>
        <Badge variant="secondary" className="font-mono">★ {review.score}/10</Badge>
        {review.has_spoilers && <Badge variant="outline">spoilers</Badge>}
        <time
          dateTime={review.created_at}
          className="ml-auto font-mono text-xs text-muted-foreground"
        >
          {new Date(review.created_at).toLocaleDateString()}
        </time>
      </header>

      <SpoilerGuard active={review.has_spoilers}>
        <p
          className={`whitespace-pre-line text-sm leading-relaxed text-foreground/90 ${
            clampBody ? "line-clamp-6" : ""
          }`}
        >
          {review.body}
        </p>
      </SpoilerGuard>

      <footer className="flex items-center gap-3">
        <HelpfulButton review={review} />
        {clampBody && (
          <Link
            href={`/reviews/${review.id}`}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Full review
          </Link>
        )}
      </footer>
    </article>
  );
}

function HelpfulButton({ review }: { review: Review }) {
  const { status } = useSession();
  const [voted, setVoted] = useState(review.voted);
  const [count, setCount] = useState(review.helpful_count);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (status !== "authed") {
      toast("Sign in to vote on reviews");
      return;
    }
    if (review.is_mine) {
      toast("You can't vote on your own review");
      return;
    }
    setBusy(true);
    const next = !voted;
    // Optimistic flip; server response is authoritative.
    setVoted(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      const res = next
        ? await browserApi.PUT("/reviews/{reviewId}/helpful", { params: { path: { reviewId: review.id } } })
        : await browserApi.DELETE("/reviews/{reviewId}/helpful", { params: { path: { reviewId: review.id } } });
      if (res.error) throw new Error(res.error.error.message);
      setVoted(res.data.voted);
      setCount(res.data.helpful_count);
    } catch (err) {
      setVoted(!next);
      setCount((c) => c + (next ? -1 : 1));
      toast.error(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={voted ? "secondary" : "ghost"}
      size="sm"
      onClick={toggle}
      disabled={busy}
      aria-pressed={voted}
    >
      <ThumbsUpIcon weight={voted ? "fill" : "regular"} />
      Helpful{count > 0 ? ` · ${count}` : ""}
    </Button>
  );
}
