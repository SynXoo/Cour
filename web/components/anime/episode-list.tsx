"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { airDateLabel, isUpcoming, untilLabel } from "@/lib/anime";
import {
  buildRanges,
  DEFAULT_ORDER,
  type Episode,
  type EpisodeOrder,
  inRange,
  needsPagination,
  orderEpisodes,
} from "@/lib/episodes";
import { cn } from "@/lib/utils";

// Each episode row deep-links into its discussion thread — the weekly
// watch-along entry point. Short shows render as a plain ascending column;
// long-running ones (One Piece scale) get a newest-first default, an
// order toggle, and range pages of 50 so tonight's episode is one tap away.
export function EpisodeList({ animeId, episodes }: { animeId: number; episodes: Episode[] }) {
  if (!needsPagination(episodes)) {
    return <EpisodeGrid animeId={animeId} episodes={episodes} />;
  }
  return <PaginatedEpisodes animeId={animeId} episodes={episodes} />;
}

function PaginatedEpisodes({ animeId, episodes }: { animeId: number; episodes: Episode[] }) {
  const ranges = useMemo(() => buildRanges(episodes), [episodes]);
  const [order, setOrder] = useState<EpisodeOrder>(DEFAULT_ORDER);
  const [rangeId, setRangeId] = useState(() => ranges[0]?.id ?? "");

  const active = ranges.find((r) => r.id === rangeId) ?? ranges[0];
  const shown = useMemo(
    () => orderEpisodes(episodes.filter((e) => inRange(e, active)), order),
    [episodes, active, order],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Episode order" className="flex gap-1">
          <Chip active={order === "desc"} onClick={() => setOrder("desc")}>
            Newest
          </Chip>
          <Chip active={order === "asc"} onClick={() => setOrder("asc")}>
            Oldest
          </Chip>
        </div>
        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
          {episodes.length} episodes
        </span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Episode range">
        {ranges.map((r) => (
          <Chip key={r.id} active={r.id === active.id} onClick={() => setRangeId(r.id)}>
            {r.label}
          </Chip>
        ))}
      </div>

      <EpisodeGrid animeId={animeId} episodes={shown} />
    </div>
  );
}

function EpisodeGrid({ animeId, episodes }: { animeId: number; episodes: Episode[] }) {
  return (
    <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {episodes.map((e) => {
        const upcoming = isUpcoming(e.airing_at);
        return (
          <li key={e.number}>
            <Link
              href={`/anime/${animeId}/episode/${e.number}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2 text-sm transition-colors hover:border-primary/50 md:min-h-0 md:items-baseline"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono font-semibold">Ep {e.number}</span>
                {e.title && <span className="truncate text-muted-foreground">{e.title}</span>}
              </span>
              {e.airing_at && (
                <span
                  className={`shrink-0 font-mono text-xs ${upcoming ? "text-primary" : "text-muted-foreground"}`}
                  title={airDateLabel(e.airing_at)}
                >
                  {upcoming ? untilLabel(e.airing_at) : airDateLabel(e.airing_at)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
      className={cn("font-mono", !active && "text-muted-foreground")}
    >
      {children}
    </Button>
  );
}
