"use client";

import { CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { airDateLabel, isUpcoming, untilLabel } from "@/lib/anime";
import {
  buildRanges,
  DEFAULT_ORDER,
  type Episode,
  type EpisodeOrder,
  type EpisodeRange,
  episodeState,
  inRange,
  needsPagination,
  nextUpNumber,
  orderEpisodes,
  progressSummary,
  rangeContaining,
} from "@/lib/episodes";
import { useMyListEntry, useUpsertEntry, type ListEntry } from "@/lib/hooks/use-list";
import { useAnimeFriends } from "@/lib/hooks/use-social";
import { friendMarkers, type FriendOnAnime } from "@/lib/social";
import { cn } from "@/lib/utils";

// Each episode row deep-links into its discussion thread — the weekly
// watch-along entry point. Short shows render as a plain ascending column;
// long-running ones (One Piece scale) get a newest-first default, an
// order toggle, and range pages of 50 so tonight's episode is one tap away.
//
// Signed in with the show on your list, the list also knows where you are
// (§M3.10): watched rows are ticked, the next one is "Up next" with a
// one-tap Watched that walks the highlight down, and friends sit on the
// rows they're on.
export function EpisodeList({
  animeId,
  episodes,
  episodesCount,
}: {
  animeId: number;
  episodes: Episode[];
  episodesCount: number | null;
}) {
  const { data: entry } = useMyListEntry(animeId);
  const { data: friends } = useAnimeFriends(animeId);
  const here = useMemo<Here | null>(() => {
    if (!entry) return null;
    return { entry, nextUp: nextUpNumber(episodes, entry.progress) };
  }, [entry, episodes]);
  const markers = useMemo(() => friendMarkers(friends?.data ?? []), [friends]);

  return (
    <div className="flex flex-col gap-3">
      {here && (
        <p className="text-sm">
          <span className="font-medium text-primary">{progressSummary(here.entry.progress, episodesCount, here.nextUp)}</span>
        </p>
      )}
      {needsPagination(episodes) ? (
        <PaginatedEpisodes animeId={animeId} episodes={episodes} here={here} markers={markers} />
      ) : (
        <EpisodeGrid animeId={animeId} episodes={episodes} here={here} markers={markers} />
      )}
    </div>
  );
}

/** The viewer's entry plus the episode they should watch next. */
type Here = { entry: ListEntry; nextUp: number | null };
type Markers = Map<number, FriendOnAnime[]>;

function PaginatedEpisodes({
  animeId,
  episodes,
  here,
  markers,
}: {
  animeId: number;
  episodes: Episode[];
  here: Here | null;
  markers: Markers;
}) {
  const ranges = useMemo(() => buildRanges(episodes), [episodes]);
  const [order, setOrder] = useState<EpisodeOrder>(DEFAULT_ORDER);
  // null = "auto": follow the viewer's next-up episode (which arrives async
  // with the list entry) until they pick a range themselves.
  const [rangeId, setRangeId] = useState<string | null>(null);

  const active: EpisodeRange | undefined =
    (rangeId != null ? ranges.find((r) => r.id === rangeId) : undefined) ??
    rangeContaining(ranges, here?.nextUp ?? null) ??
    ranges[0];
  const shown = useMemo(
    () => (active ? orderEpisodes(episodes.filter((e) => inRange(e, active)), order) : []),
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
          <Chip key={r.id} active={r.id === active?.id} onClick={() => setRangeId(r.id)}>
            {r.label}
          </Chip>
        ))}
      </div>

      <EpisodeGrid animeId={animeId} episodes={shown} here={here} markers={markers} />
    </div>
  );
}

function EpisodeGrid({
  animeId,
  episodes,
  here,
  markers,
}: {
  animeId: number;
  episodes: Episode[];
  here: Here | null;
  markers: Markers;
}) {
  const upsert = useUpsertEntry(animeId);

  function markWatched(number: number) {
    if (!here) return;
    const { entry } = here;
    upsert.mutate({
      // First tick on a planned show means you've started it.
      status: entry.status === "planning" ? "watching" : entry.status,
      score: entry.score ?? 0,
      progress: number,
    });
  }

  return (
    <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {episodes.map((e) => {
        const upcoming = isUpcoming(e.airing_at);
        const state = here ? episodeState(e.number, here.entry.progress, here.nextUp) : null;
        const friendsHere = markers.get(e.number);
        return (
          <li key={e.number} data-state={state ?? undefined} className="flex items-stretch gap-1.5">
            <Link
              href={`/anime/${animeId}/episode/${e.number}`}
              className={cn(
                "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/50 md:min-h-0 md:items-baseline",
                state === "watched" && "border-border/40 text-muted-foreground",
                state === "next" && "border-primary bg-primary/5 ring-1 ring-primary/30",
                state !== "watched" && state !== "next" && "border-border/60",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 md:items-baseline">
                {state === "watched" && (
                  <>
                    <CheckIcon size={12} weight="bold" aria-hidden className="shrink-0 text-primary" />
                    <span className="sr-only">Watched</span>
                  </>
                )}
                <span className="font-mono font-semibold">Ep {e.number}</span>
                {state === "next" && (
                  <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                    Up next
                  </span>
                )}
                {e.title && <span className="truncate text-muted-foreground">{e.title}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {friendsHere && <FriendMarkers friends={friendsHere} />}
                {e.airing_at && (
                  <span
                    className={cn("font-mono text-xs", upcoming ? "text-gold" : "text-muted-foreground")}
                    title={airDateLabel(e.airing_at)}
                  >
                    {upcoming ? untilLabel(e.airing_at) : airDateLabel(e.airing_at)}
                  </span>
                )}
              </span>
            </Link>
            {state === "next" && !upcoming && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Mark episode ${e.number} watched`}
                title="Mark watched"
                disabled={upsert.isPending}
                onClick={() => markWatched(e.number)}
                className="h-auto min-h-11 shrink-0 gap-1 border-primary/40 px-2.5 font-mono text-xs text-primary hover:bg-primary/10 md:min-h-0"
              >
                <CheckIcon size={12} weight="bold" aria-hidden />
                Watched
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const MAX_MARKERS = 3;

/** Stacked avatars for the friends parked on an episode. */
function FriendMarkers({ friends }: { friends: FriendOnAnime[] }) {
  const shown = friends.slice(0, MAX_MARKERS);
  const extra = friends.length - shown.length;
  const names = shown.map((f) => f.user.username).join(", ");
  const label = `${names}${extra > 0 ? ` and ${extra} more` : ""} ${friends.length === 1 ? "is" : "are"} here`;
  return (
    <span role="img" aria-label={label} title={label} className="flex items-center -space-x-1.5">
      {shown.map((f) => (
        <Avatar key={f.user.username} className="h-5 w-5 border border-background text-[8px]">
          {f.user.avatar_url && <AvatarImage src={f.user.avatar_url} alt="" />}
          <AvatarFallback>{f.user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-background bg-muted px-1 font-mono text-[9px] text-muted-foreground">
          +{extra}
        </span>
      )}
    </span>
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
