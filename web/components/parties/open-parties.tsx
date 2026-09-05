"use client";

import { UsersThreeIcon } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { displayTitle } from "@/lib/anime";
import { useOpenParties, type WatchPartySummary } from "@/lib/hooks/use-parties";
import { cn } from "@/lib/utils";

/**
 * Discovery rail (M4.4): the open parties the viewer may join, as compact
 * cards. Renders nothing when the feature is off or no room is open, so
 * the schedule and home pages can mount it unconditionally. Anonymous
 * viewers see public rooms; joining asks them to sign in on the party page.
 */
export function OpenParties({
  limit = 6,
  heading = "Watching together right now",
  className,
}: {
  limit?: number;
  heading?: string;
  className?: string;
}) {
  const parties = useOpenParties({ limit });
  const rooms = parties.data ?? [];
  if (rooms.length === 0) return null;

  return (
    <section aria-labelledby="open-parties" className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="open-parties" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <UsersThreeIcon size={20} weight="fill" className="text-primary" aria-hidden />
          {heading}
        </h2>
        <p className="font-mono text-xs text-muted-foreground">{partyCountLabel(rooms)}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((p) => (
          <li key={p.id}>
            <PartyCard party={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "3 rooms · 11 watching" */
export function partyCountLabel(rooms: WatchPartySummary[]): string {
  const watching = rooms.reduce((n, p) => n + p.watching, 0);
  const roomsLabel = `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`;
  return watching > 0 ? `${roomsLabel} · ${watching} watching` : roomsLabel;
}

export function PartyCard({ party }: { party: WatchPartySummary }) {
  const { anime, episode, host } = party;
  return (
    <Link
      href={`/parties/${party.id}`}
      className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card p-2 pr-3 transition-colors hover:border-primary/50"
    >
      <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-muted">
        {anime.cover_image && (
          <Image src={anime.cover_image} alt="" fill sizes="40px" className="object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{displayTitle(anime)}</span>
        <span className="block truncate text-xs text-muted-foreground">
          Ep {episode.number} · @{host.username}
          {party.visibility !== "public" && (
            <span className="ml-1 rounded-full border border-border px-1.5 py-px text-[10px] uppercase">
              {party.visibility}
            </span>
          )}
        </span>
      </span>
      <span
        className="shrink-0 font-mono text-xs text-muted-foreground"
        aria-label={`${party.watching} watching`}
      >
        <span className="relative mr-1.5 inline-flex h-1.5 w-1.5">
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75",
              party.watching > 0 && "animate-ping bg-live motion-reduce:animate-none",
            )}
          />
          <span
            className={cn(
              "relative inline-flex h-1.5 w-1.5 rounded-full",
              party.watching > 0 ? "bg-live" : "bg-muted-foreground/40",
            )}
          />
        </span>
        {party.watching}
      </span>
    </Link>
  );
}
