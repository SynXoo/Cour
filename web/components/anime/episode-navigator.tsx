"use client";

import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { airDateLabel, isUpcoming, untilLabel } from "@/lib/anime";
import {
  anchorNumber,
  buildRanges,
  type Episode,
  type EpisodeRange,
  episodeState,
  inRange,
  type JumpTarget,
  jumpTargets,
  needsPagination,
  nextUpNumber,
  progressSummary,
  railDateLabel,
  rangeContaining,
  searchEpisodes,
} from "@/lib/episodes";
import { useMyListEntry, useUpsertEntry, type ListEntry } from "@/lib/hooks/use-list";
import { useAnimeFriends } from "@/lib/hooks/use-social";
import { friendMarkers, type FriendOnAnime } from "@/lib/social";
import { cn } from "@/lib/utils";

// Getting to an episode, not reading a directory (§M3.11). A show is a place
// you re-enter, so the three ways in come first — pick up where you left off,
// start at the beginning, jump to the newest one out — with a jump box for
// "episode 813, the Whole Cake one". The episodes themselves are a rail that
// opens parked on where you are rather than a grid of a thousand rows; long
// runs page the rail by fifties.
//
// Each card deep-links into that episode's discussion thread. Signed in with
// the show on your list, the rail also knows where you are (§M3.10): watched
// cards are ticked, the next one is "Up next" with a one-tap Watched that
// walks the highlight along, and friends sit on the episodes they're on.
export function EpisodeNavigator({
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

  const anchor = useMemo(() => anchorNumber(episodes, here?.nextUp ?? null), [episodes, here]);
  const targets = useMemo(() => jumpTargets(episodes, here?.nextUp ?? null), [episodes, here]);

  const ranges = useMemo(() => buildRanges(episodes), [episodes]);
  const paged = needsPagination(episodes);
  // null = "auto": follow the anchor episode (which moves as the list entry
  // resolves) until the viewer picks a range themselves.
  const [rangeId, setRangeId] = useState<string | null>(null);
  const active: EpisodeRange | undefined =
    (rangeId != null ? ranges.find((r) => r.id === rangeId) : undefined) ??
    rangeContaining(ranges, anchor) ??
    ranges.at(-1);

  const shown = useMemo(() => {
    const list = paged && active ? episodes.filter((e) => inRange(e, active)) : episodes;
    return [...list].sort((a, b) => a.number - b.number);
  }, [episodes, active, paged]);

  return (
    <div className="flex flex-col gap-3">
      {here && (
        <p className="text-sm font-medium text-primary">
          {progressSummary(here.entry.progress, episodesCount, here.nextUp)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <JumpRow animeId={animeId} targets={targets} />
        <EpisodeSearch animeId={animeId} episodes={episodes} onPick={setRangeId} ranges={ranges} />
      </div>

      <EpisodeRail
        animeId={animeId}
        episodes={shown}
        anchor={anchor}
        here={here}
        markers={markers}
        // Long runs mirrored from AniList are often bare numbers with no
        // titles and no air dates. Cards that wide would be mostly empty
        // box, so the rail narrows to what the show actually has to say.
        titled={episodes.some((e) => e.title)}
      />

      {paged && active && (
        <RangeStepper
          ranges={ranges}
          active={active}
          total={episodes.length}
          onSelect={setRangeId}
        />
      )}
    </div>
  );
}

/** The viewer's entry plus the episode they should watch next. */
type Here = { entry: ListEntry; nextUp: number | null };
type Markers = Map<number, FriendOnAnime[]>;

/** Continue / Start / Latest — the first one is the primary action. */
function JumpRow({ animeId, targets }: { animeId: number; targets: JumpTarget[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((t, i) => (
        <Button
          key={t.key}
          asChild
          size="sm"
          variant={i === 0 ? "default" : "outline"}
          className={cn("min-h-11 font-mono sm:min-h-0", i !== 0 && "text-muted-foreground")}
        >
          <Link href={`/anime/${animeId}/episode/${t.number}`}>{t.label}</Link>
        </Button>
      ))}
    </div>
  );
}

/**
 * Jump box: a number goes straight to that episode, text searches titles.
 * Picking a result also moves the rail to that episode's range, so backing
 * out of the thread lands you where you were looking.
 */
function EpisodeSearch({
  animeId,
  episodes,
  ranges,
  onPick,
}: {
  animeId: number;
  episodes: Episode[];
  ranges: EpisodeRange[];
  onPick: (rangeId: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchEpisodes(episodes, query), [episodes, query]);

  function go(number: number) {
    const range = rangeContaining(ranges, number);
    if (range) onPick(range.id);
    setOpen(false);
    setQuery("");
    router.push(`/anime/${animeId}/episode/${number}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // role=combobox takes no name from its contents — say it outright.
          aria-label="Jump to an episode"
          // Full width on a phone, where it reads as the search bar it is;
          // a trailing button on the jump row once there's room beside it.
          className="min-h-11 w-full justify-start gap-2 text-muted-foreground sm:ml-auto sm:w-auto sm:min-h-0 sm:justify-center"
        >
          <MagnifyingGlassIcon size={14} aria-hidden />
          Jump to an episode
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Episode number or title…"
            autoFocus
          />
          <CommandList>
            {query.trim() === "" ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Type a number — or part of an episode title.
              </p>
            ) : matches.length === 0 ? (
              <CommandEmpty>No episode matches “{query.trim()}”.</CommandEmpty>
            ) : (
              matches.map((e) => (
                <CommandItem key={e.number} value={String(e.number)} onSelect={() => go(e.number)}>
                  <span className="font-mono font-semibold">Ep {e.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.title}</span>
                  {e.airing_at && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {isUpcoming(e.airing_at) ? untilLabel(e.airing_at) : airDateLabel(e.airing_at)}
                    </span>
                  )}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** How far one arrow press moves the rail, as a fraction of its width. */
const SCROLL_STEP = 0.8;

function EpisodeRail({
  animeId,
  episodes,
  anchor,
  here,
  markers,
  titled,
}: {
  animeId: number;
  episodes: Episode[];
  anchor: number | null;
  here: Here | null;
  markers: Markers;
  titled: boolean;
}) {
  const upsert = useUpsertEntry(animeId);
  const rail = useRef<HTMLOListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const readEdges = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    // Sub-pixel widths: a rail scrolled fully right can land a hair short.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(readEdges, [readEdges, episodes]);

  // Park the rail on the anchor episode — mandatory snapping then settles it
  // flush left, so you open on where you're going with what's ahead beside
  // it and your history one arrow back. `anchor` arrives async with the list
  // entry, so this re-runs when it resolves, but jumps without animating so
  // it never looks like the page moved under the viewer.
  useEffect(() => {
    const el = rail.current;
    if (!el || anchor == null) return;
    const card = el.querySelector<HTMLElement>(`[data-episode="${anchor}"]`);
    if (!card) return;
    el.scrollLeft += card.getBoundingClientRect().left - el.getBoundingClientRect().left;
    readEdges();
  }, [anchor, episodes, readEdges]);

  function scrollBy(direction: 1 | -1) {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * SCROLL_STEP, behavior: "smooth" });
  }

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
    <div className="relative">
      <ol
        ref={rail}
        onScroll={readEdges}
        aria-label="Episodes"
        // No `scroll-smooth` here: parking the rail on the anchor sets
        // scrollLeft directly and must land instantly. The arrows ask for
        // smooth scrolling themselves.
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2"
      >
        {episodes.map((e) => {
          const upcoming = isUpcoming(e.airing_at);
          const state = here ? episodeState(e.number, here.entry.progress, here.nextUp) : null;
          const friendsHere = markers.get(e.number);
          return (
            <li
              key={e.number}
              data-episode={e.number}
              data-state={state ?? undefined}
              className={cn("shrink-0 snap-start", titled ? "w-44 sm:w-48" : "w-28")}
            >
              <div
                className={cn(
                  // `relative` is load-bearing: the watched tick's sr-only
                  // label is absolutely positioned, and without a containing
                  // block inside the card it escapes the scroller and gives
                  // the whole page a horizontal scrollbar.
                  "relative flex h-full flex-col rounded-lg border bg-card transition-colors hover:border-primary/50",
                  state === "watched" && "border-border/40",
                  state === "next" && "border-primary bg-primary/5 ring-1 ring-primary/30",
                  state !== "watched" && state !== "next" && "border-border/60",
                )}
              >
                <Link
                  href={`/anime/${animeId}/episode/${e.number}`}
                  className={cn(
                    "flex flex-1 flex-col gap-1.5",
                    // Nothing but a number to show: a chip, not an empty box.
                    titled ? "min-h-24 p-3" : "px-3 py-2.5",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    {state === "watched" && (
                      <>
                        <CheckIcon size={12} weight="bold" aria-hidden className="shrink-0 text-primary" />
                        <span className="sr-only">Watched</span>
                      </>
                    )}
                    <span
                      className={cn(
                        "font-mono font-semibold whitespace-nowrap",
                        state === "watched" && "text-muted-foreground",
                      )}
                    >
                      Ep {e.number}
                    </span>
                    {state === "next" && (
                      <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                        Up next
                      </span>
                    )}
                  </span>
                  {e.title && (
                    <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {e.title}
                    </span>
                  )}
                  {(e.airing_at || friendsHere) && (
                  <span className="mt-auto flex items-center gap-2 pt-1">
                    {e.airing_at && (
                      <span
                        className={cn(
                          "font-mono text-xs whitespace-nowrap",
                          upcoming ? "text-gold" : "text-muted-foreground",
                        )}
                        title={airDateLabel(e.airing_at)}
                      >
                        {upcoming ? untilLabel(e.airing_at) : railDateLabel(e.airing_at)}
                      </span>
                    )}
                    {friendsHere && <FriendMarkers friends={friendsHere} />}
                  </span>
                  )}
                </Link>
                {state === "next" && !upcoming && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Mark episode ${e.number} watched`}
                    disabled={upsert.isPending}
                    onClick={() => markWatched(e.number)}
                    className="min-h-11 w-full justify-center gap-1 rounded-t-none border-t border-primary/30 font-mono text-xs text-primary hover:bg-primary/10 md:min-h-9"
                  >
                    <CheckIcon size={12} weight="bold" aria-hidden />
                    Watched
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <RailArrow side="left" disabled={atStart} onClick={() => scrollBy(-1)} />
      <RailArrow side="right" disabled={atEnd} onClick={() => scrollBy(1)} />
    </div>
  );
}

/**
 * Rail arrows sit over the ends of the rail and fade out where there's
 * nothing left that way. Pointer-only: touch scrolls, and every card is
 * reachable by keyboard through the rail itself.
 */
function RailArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? CaretLeftIcon : CaretRightIcon;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-opacity hover:text-foreground sm:flex",
        side === "left" ? "-left-3" : "-right-3",
        disabled && "pointer-events-none opacity-0",
      )}
    >
      <Icon size={16} weight="bold" />
    </button>
  );
}

/**
 * Range paging for long runs. A stepper plus a menu of every fifty, rather
 * than the twenty-odd chips One Piece would otherwise spray across the page.
 */
function RangeStepper({
  ranges,
  active,
  total,
  onSelect,
}: {
  ranges: EpisodeRange[];
  active: EpisodeRange;
  total: number;
  onSelect: (rangeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const at = ranges.findIndex((r) => r.id === active.id);
  const step = (delta: number) => {
    const next = ranges[at + delta];
    if (next) onSelect(next.id);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1" role="group" aria-label="Episode range">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Earlier episodes"
          disabled={at <= 0}
          onClick={() => step(-1)}
          className="min-h-11 sm:min-h-0"
        >
          <CaretLeftIcon size={14} weight="bold" aria-hidden />
        </Button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Episodes ${active.label} — choose a range`}
              className="min-h-11 font-mono tabular-nums sm:min-h-0"
            >
              {active.label}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-0">
            <Command>
              <CommandList>
                {ranges.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={r.label}
                    onSelect={() => {
                      onSelect(r.id);
                      setOpen(false);
                    }}
                    className="font-mono tabular-nums"
                  >
                    <span className="flex-1">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.count}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Later episodes"
          disabled={at >= ranges.length - 1}
          onClick={() => step(1)}
          className="min-h-11 sm:min-h-0"
        >
          <CaretRightIcon size={14} weight="bold" aria-hidden />
        </Button>
      </div>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {total} episodes
      </span>
    </div>
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
    <span role="img" aria-label={label} title={label} className="ml-auto flex items-center -space-x-1.5">
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
