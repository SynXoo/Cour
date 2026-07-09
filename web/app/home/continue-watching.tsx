"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { animeHref, displayTitle } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";
import { useMyList, useUpsertEntry } from "@/lib/hooks/use-list";
import { continueWatching, type ContinueRow } from "@/lib/home";

/**
 * Shows you're behind on, most recently touched first. Each card carries the
 * whole loop: see where you are, mark the next episode watched in one tap
 * (the bar fills, the count pops), then jump into that episode's thread.
 * Renders nothing while loading or when the viewer is fully caught up —
 * absence is the reward, not an empty state.
 */
export function ContinueWatching() {
  const { status } = useSession();
  const { data: list } = useMyList("watching");

  const rows = useMemo(() => continueWatching(list ?? []), [list]);

  if (status !== "authed" || rows.length === 0) return null;

  return (
    <section aria-labelledby="continue-watching" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="continue-watching" className="text-lg font-semibold tracking-tight">
          Continue <span className="text-primary">watching</span>
        </h2>
        <Link href="/list" className="text-sm text-muted-foreground hover:text-primary">
          My list →
        </Link>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {rows.map((row) => (
          <ContinueCard key={row.anime.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function ContinueCard({ row }: { row: ContinueRow }) {
  const upsert = useUpsertEntry(row.anime.id);
  const a = row.anime;
  const pct = row.total ? Math.min(100, (row.progress / row.total) * 100) : null;

  return (
    <li
      className="tint-card w-64 shrink-0 rounded-lg border p-2.5"
      style={a.cover_color ? ({ "--tint": a.cover_color } as React.CSSProperties) : undefined}
    >
      <div className="flex items-center gap-3">
        <Link
          href={animeHref(a)}
          tabIndex={-1}
          aria-hidden
          className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted"
        >
          {a.cover_image && (
            <Image src={a.cover_image} alt="" fill sizes="48px" className="object-cover" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={animeHref(a)}
            className="line-clamp-1 text-sm font-medium hover:text-primary"
          >
            {displayTitle(a)}
          </Link>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {/* Keyed by progress: the count replays a tapback pop per +1. */}
            <span key={row.progress} className="inline-block tapback-pop">
              {row.progress}
              {row.total ? `/${row.total}` : ""}
            </span>{" "}
            watched
          </p>
          {pct != null && <Progress value={pct} className="mt-1.5 rounded-full" />}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-11 w-11 shrink-0 border-primary/40 font-mono text-primary hover:bg-primary/10 hover:text-primary md:h-8 md:w-9"
          disabled={upsert.isPending}
          aria-label={`Mark episode ${row.nextEp} of ${displayTitle(a)} watched`}
          onClick={() => upsert.mutate({ status: "watching", progress: row.nextEp })}
        >
          +1
        </Button>
      </div>
      <Link
        href={`/anime/${a.id}/episode/${row.nextEp}`}
        className="mt-2 block truncate font-mono text-xs text-muted-foreground hover:text-primary"
      >
        Discuss ep {row.nextEp} →
      </Link>
    </li>
  );
}
