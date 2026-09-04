"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { AnimeCard } from "@/components/anime/anime-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { animeHref, displayTitle } from "@/lib/anime";
import type { AnimeSummary, ScheduleEntry } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useMyList } from "@/lib/hooks/use-list";
import { myTonight, nextUpLater } from "@/lib/home";
import { Countdown } from "./countdown";
import { EveningTimeline } from "./evening-timeline";
import { QuietNightRecs } from "./quiet-night-recs";

type RoomStats = Record<string, { presence: number; comments: number }>;

/**
 * The home's headliner: tonight's episodes from the viewer's watching list.
 * The soonest one gets the spotlight — cover-color stage lighting, a live
 * countdown, and the room's pulse — the rest line up in a rail. The list is
 * client data (the access token never leaves the browser), so the server
 * renders a skeleton and this island resolves it.
 */
export function YourEvening({
  schedule,
  rooms,
  seasonal,
}: {
  schedule: ScheduleEntry[];
  rooms: RoomStats;
  seasonal: AnimeSummary[];
}) {
  const { status } = useSession();
  const { data: list, isPending } = useMyList("watching");

  const watchingIds = useMemo(() => new Set((list ?? []).map((e) => e.anime_id)), [list]);
  // The clock is frozen at compute time on purpose: Countdown owns the
  // ticking, and the react-hooks purity rule bars Date.now() in plain render.
  const { tonight, later, headlinerAired } = useMemo(() => {
    const now = new Date();
    const mine = myTonight(schedule, watchingIds, now);
    return {
      tonight: mine,
      later: nextUpLater(schedule, watchingIds, now),
      headlinerAired:
        mine.length > 0 && new Date(mine[0].airing_at).getTime() <= now.getTime(),
    };
  }, [schedule, watchingIds]);

  if (status === "loading" || (status === "authed" && isPending)) {
    return (
      <div className="space-y-3" data-testid="evening-skeleton">
        <Skeleton className="h-44 rounded-xl sm:h-48" />
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[5.25rem] w-60 shrink-0 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Stale session marker: the shell said "member", the session says no.
  if (status === "anon") {
    return (
      <EmptyEvening
        seasonal={seasonal}
        headline="Your session took the night off."
        sub="Sign back in and tonight's episodes from your list line up right here."
        cta={
          <Button asChild className="h-11 px-5 text-sm md:h-9">
            <Link href="/login">Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (watchingIds.size === 0) {
    return (
      <EmptyEvening
        seasonal={seasonal}
        headline="Your evening is unwritten."
        sub="Pick the shows you're watching and every airing night starts here — countdowns, live rooms, people watching with you."
        cta={
          <>
            <Button asChild className="h-11 px-5 text-sm md:h-9">
              <Link href="/seasonal">Browse the season</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 px-5 text-sm md:h-9">
              <Link href="/settings/import">Import your list</Link>
            </Button>
          </>
        }
      />
    );
  }

  if (tonight.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Nothing on your list airs in the next 24 hours
          {later.length > 0
            ? " — here's the week ahead."
            : " — and the week's schedule is clear."}
        </p>
        {later.length > 0 && (
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {later.map((e) => (
              <EveningTile key={`${e.anime.id}-${e.episode}`} entry={e} rooms={rooms} withDay />
            ))}
          </ul>
        )}
        <QuietNightRecs seasonal={seasonal} />
      </div>
    );
  }

  const [headliner, ...rest] = tonight;

  return (
    <div className="space-y-3">
      <Spotlight entry={headliner} rooms={rooms} aired={headlinerAired} />
      {/* Desktop reads tonight as a timeline; under lg the rail carries it. */}
      <EveningTimeline entries={tonight} rooms={rooms} />
      {rest.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-2 lg:hidden">
          {rest.map((e) => (
            <EveningTile key={`${e.anime.id}-${e.episode}`} entry={e} rooms={rooms} />
          ))}
        </ul>
      )}
    </div>
  );
}

const roomKey = (e: ScheduleEntry) => `${e.anime.id}:${e.episode}`;
const tintStyle = (a: AnimeSummary) =>
  a.cover_color ? ({ "--tint": a.cover_color } as React.CSSProperties) : undefined;

/** Tonight's soonest episode, staged big. */
function Spotlight({
  entry,
  rooms,
  aired,
}: {
  entry: ScheduleEntry;
  rooms: RoomStats;
  aired: boolean;
}) {
  const a = entry.anime;
  const room = rooms[roomKey(entry)];

  return (
    <article
      className="tint-card room-enter relative overflow-hidden rounded-xl border"
      style={tintStyle(a)}
    >
      <div aria-hidden className="tint-glow pointer-events-none absolute inset-0" />
      <div className="relative flex items-center gap-4 p-4 sm:gap-6 sm:p-5">
        <Link
          href={animeHref(a)}
          tabIndex={-1}
          aria-hidden
          className="relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted sm:w-32"
        >
          {a.cover_image && (
            <Image
              src={a.cover_image}
              alt=""
              fill
              // The island mounts after hydration, but the spotlight art is
              // usually the page's LCP — load it eagerly once it exists.
              priority
              sizes="(max-width: 640px) 96px, 128px"
              className="object-cover"
            />
          )}
        </Link>

        <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-2">
          <p
            className={`flex items-center gap-2 font-mono text-xs uppercase tracking-widest ${aired ? "text-live" : "text-primary"}`}
          >
            {aired && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
              </span>
            )}
            {aired ? "Live — the room is open" : "Up next on your list"}
          </p>
          <h3 className="text-lg font-bold leading-tight tracking-tight sm:text-2xl">
            <Link href={animeHref(a)} className="line-clamp-2 hover:text-primary">
              {displayTitle(a)}
            </Link>
          </h3>
          <p className="font-mono text-base font-semibold tabular-nums sm:text-xl">
            Ep {entry.episode} ·{" "}
            <Countdown iso={entry.airing_at} className="text-gold" />
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {room && (room.presence > 0 || room.comments > 0) ? (
              <>
                {room.presence > 0 && (
                  <span className="text-live">{room.presence} in the room now · </span>
                )}
                {room.comments} comment{room.comments === 1 ? "" : "s"} so far
              </>
            ) : (
              "The room's still quiet — take the first word"
            )}
          </p>
          <div className="pt-1">
            <Button asChild className="h-11 px-5 text-sm md:h-9">
              <Link href={`/anime/${a.id}/episode/${entry.episode}`}>Into the thread</Link>
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** The rest of tonight (or the week ahead, with a weekday tag). */
function EveningTile({
  entry,
  rooms,
  withDay = false,
}: {
  entry: ScheduleEntry;
  rooms: RoomStats;
  withDay?: boolean;
}) {
  const a = entry.anime;
  const room = rooms[roomKey(entry)];
  const day = withDay
    ? new Date(entry.airing_at).toLocaleDateString(undefined, { weekday: "short" })
    : null;

  return (
    <li className="w-60 shrink-0">
      <Link
        href={`/anime/${a.id}/episode/${entry.episode}`}
        className="tint-card flex h-full items-center gap-3 rounded-lg border p-2.5 transition-colors"
        style={tintStyle(a)}
      >
        <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
          {a.cover_image && (
            <Image src={a.cover_image} alt="" fill sizes="48px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{displayTitle(a)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {day && `${day} · `}Ep {entry.episode} ·{" "}
            <Countdown iso={entry.airing_at} className="text-gold" />
          </p>
          {room && room.presence > 0 && (
            <p className="font-mono text-xs text-live">{room.presence} in there now</p>
          )}
        </div>
      </Link>
    </li>
  );
}

function EmptyEvening({
  headline,
  sub,
  cta,
  seasonal,
}: {
  headline: string;
  sub: string;
  cta: React.ReactNode;
  seasonal: AnimeSummary[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="font-medium">{headline}</p>
        <p className="mx-auto mt-1 max-w-md text-balance text-sm text-muted-foreground">{sub}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{cta}</div>
      </div>
      <SeasonalPicks seasonal={seasonal} lead="Popular this season:" />
    </div>
  );
}

function SeasonalPicks({ seasonal, lead }: { seasonal: AnimeSummary[]; lead: string }) {
  if (seasonal.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{lead}</p>
      <ul className="flex gap-4 overflow-x-auto pb-2">
        {seasonal.map((a) => (
          <li key={a.id} className="w-36 shrink-0">
            <AnimeCard anime={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}
