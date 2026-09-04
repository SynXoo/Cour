"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { displayTitle } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";
import { statusLabel, useMyList } from "@/lib/hooks/use-list";
import type { LiveRoom } from "@/lib/landing";
import {
  filterRooms,
  myRooms,
  sortRooms,
  type MyRoom,
  type RoomSort,
  type TonightRoom,
} from "@/lib/threads-hub";
import { cn } from "@/lib/utils";
import { TonightRail } from "./tonight-rail";

/**
 * The hub's body (§M3.8): four views over the same public data plus the
 * viewer's list. "Hot" is the ranked room list — the reason the tab exists
 * (a show page can't tell you what's busiest *across* shows). "My shows"
 * is the other reason: every room for the shows on your list, hot or
 * quiet, in one place. Tonight and Series talk are the time and kind
 * slices. Sort and search work inside whatever view is open.
 */

type View = "hot" | "tonight" | "mine" | "series";

const PODIUM = 3;

export function ThreadsHub({ hot, tonight }: { hot: LiveRoom[]; tonight: TonightRoom[] }) {
  const { status } = useSession();
  const { data: list } = useMyList();
  const [view, setView] = useState<View>("hot");
  const [sort, setSort] = useState<RoomSort>("hot");
  const [query, setQuery] = useState("");

  const authed = status === "authed";
  const mine = useMemo(() => myRooms(list ?? [], hot, tonight), [list, hot, tonight]);
  const series = useMemo(() => hot.filter((r) => r.kind === "series"), [hot]);
  const maxRecent = useMemo(() => Math.max(1, ...hot.map((r) => r.recent)), [hot]);

  const views: { id: View; label: string; count: number }[] = [
    { id: "hot", label: "Hot", count: hot.length },
    { id: "tonight", label: "Tonight", count: tonight.length },
    ...(authed ? [{ id: "mine" as const, label: "My shows", count: mine.length }] : []),
    { id: "series", label: "Series talk", count: series.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Room views">
          {views.map((v) => (
            <Chip key={v.id} active={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
              <span className={cn("font-mono text-[11px]", view === v.id ? "opacity-80" : "opacity-60")}>
                {v.count}
              </span>
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {(view === "hot" || view === "series") && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="sr-only sm:not-sr-only">Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as RoomSort)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                aria-label="Sort rooms"
              >
                <option value="hot">Hottest</option>
                <option value="comments">Most comments</option>
                <option value="latest">Latest activity</option>
              </select>
            </label>
          )}
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by show…"
            aria-label="Filter rooms by show"
            className="h-8 w-40 sm:w-52"
          />
        </div>
      </div>

      {view === "hot" && (
        <RankedRooms rooms={filterRooms(sortRooms(hot, sort), query)} maxRecent={maxRecent} />
      )}
      {view === "series" && (
        <RankedRooms rooms={filterRooms(sortRooms(series, sort), query)} maxRecent={maxRecent} podium={false} />
      )}
      {view === "tonight" &&
        (tonight.length > 0 ? (
          <TonightRail rooms={filterRooms(tonight, query)} />
        ) : (
          <Empty>Nothing new airs in the next 24 hours — the hot rooms are still going.</Empty>
        ))}
      {view === "mine" && <MyRooms rows={filterRooms(mine.map((m) => ({ ...m, title: displayTitle(m.anime) })), query)} maxRecent={maxRecent} />}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** Ranked hot list: a podium of three big tiles, then compact rows. */
function RankedRooms({
  rooms,
  maxRecent,
  podium = true,
}: {
  rooms: LiveRoom[];
  maxRecent: number;
  podium?: boolean;
}) {
  if (rooms.length === 0) {
    return <Empty>No room matches — try another show, or open one and say the first word.</Empty>;
  }
  const top = podium ? rooms.slice(0, PODIUM) : [];
  const rest = podium ? rooms.slice(PODIUM) : rooms;
  return (
    <div className="space-y-3">
      {top.length > 0 && (
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="podium">
          {top.map((room, i) => (
            <li key={room.threadId}>
              <PodiumTile room={room} rank={i + 1} maxRecent={maxRecent} />
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && (
        <ol className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card" start={top.length + 1}>
          {rest.map((room, i) => (
            <li key={room.threadId}>
              <RoomRow room={room} rank={top.length + i + 1} maxRecent={maxRecent} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HeatBar({ recent, maxRecent }: { recent: number; maxRecent: number }) {
  const pct = Math.max(recent > 0 ? 6 : 0, Math.round((recent / maxRecent) * 100));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full rounded-full bg-gradient-to-r from-primary to-live" style={{ width: `${pct}%` }} />
    </div>
  );
}

function RoomMeta({ room }: { room: LiveRoom }) {
  return (
    <p className="truncate font-mono text-xs text-muted-foreground">
      {room.label} · {room.commentCount} comment{room.commentCount === 1 ? "" : "s"}
      {room.recent > 0 && <span> · {room.recent} in 48h</span>}
      {room.presence > 0 && <span className="text-live"> · {room.presence} in there</span>}
    </p>
  );
}

function PodiumTile({ room, rank, maxRecent }: { room: LiveRoom; rank: number; maxRecent: number }) {
  return (
    <Link
      href={room.href}
      className="flex h-full flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 transition-colors hover:border-primary/50"
    >
      <div className="flex items-start gap-3">
        <span className="font-mono text-2xl font-bold tabular-nums text-primary">#{rank}</span>
        <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
          {room.cover && <Image src={room.cover} alt="" fill sizes="56px" className="object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{room.title}</p>
          <RoomMeta room={room} />
          <time className="font-mono text-xs text-muted-foreground">{room.ago}</time>
        </div>
      </div>
      <HeatBar recent={room.recent} maxRecent={maxRecent} />
    </Link>
  );
}

function RoomRow({ room, rank, maxRecent }: { room: LiveRoom; rank: number; maxRecent: number }) {
  return (
    <Link href={room.href} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40">
      <span className="w-7 shrink-0 font-mono text-sm tabular-nums text-muted-foreground">{rank}</span>
      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
        {room.cover && <Image src={room.cover} alt="" fill sizes="36px" className="object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{room.title}</p>
        <RoomMeta room={room} />
      </div>
      <div className="hidden w-24 shrink-0 sm:block">
        <HeatBar recent={room.recent} maxRecent={maxRecent} />
      </div>
      <time className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">{room.ago}</time>
    </Link>
  );
}

/** "My shows": one row per show on the list, whatever state its room is in. */
function MyRooms({ rows, maxRecent }: { rows: (MyRoom & { title: string })[]; maxRecent: number }) {
  if (rows.length === 0) {
    return (
      <Empty>
        Nothing on your list yet —{" "}
        <Link href="/seasonal" className="underline underline-offset-4 hover:text-foreground">
          pick this season&apos;s shows
        </Link>{" "}
        and their rooms show up here.
      </Empty>
    );
  }
  return (
    <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card" data-testid="my-rooms">
      {rows.map((m) => {
        const a = m.anime;
        return (
          <li key={a.id}>
            <Link href={m.href} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40">
              <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
                {a.cover_image && <Image src={a.cover_image} alt="" fill sizes="36px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="truncate">{m.title}</span>
                  <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                    {statusLabel(m.status)}
                  </span>
                </p>
                {m.room ? (
                  <RoomMeta room={m.room} />
                ) : m.tonight ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    Ep {m.tonight.episode} room opens <span className="text-gold">tonight</span>
                  </p>
                ) : (
                  <p className="font-mono text-xs text-muted-foreground">Series room · quiet — say the first word</p>
                )}
              </div>
              <div className="hidden w-24 shrink-0 sm:block">
                <HeatBar recent={m.room?.recent ?? 0} maxRecent={maxRecent} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
