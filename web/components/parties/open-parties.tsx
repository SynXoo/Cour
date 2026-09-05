"use client";

import { ArrowRightIcon, UsersThreeIcon } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { displayTitle } from "@/lib/anime";
import { useFeatures } from "@/lib/hooks/use-features";
import { useOpenParties, type WatchPartySummary } from "@/lib/hooks/use-parties";
import { cn } from "@/lib/utils";

/**
 * Discovery rail (M4.4): the open parties the viewer may join, as compact
 * cards, with a "see all" line into the `/parties` hub.
 *
 * `whenEmpty` decides what an evening with no open room looks like. The
 * original `"hide"` renders nothing — right for a page that already has a
 * parties surface of its own. `"invite"` keeps a one-line strip pointing at
 * the hub instead: a feature that disappears whenever nobody happens to be
 * using it can never be discovered, which is exactly how parties stayed
 * invisible between M4.4 and now.
 */
export function OpenParties({
  limit = 6,
  heading = "Watching together right now",
  whenEmpty = "hide",
  className,
}: {
  limit?: number;
  heading?: string;
  whenEmpty?: "hide" | "invite";
  className?: string;
}) {
  const features = useFeatures();
  const parties = useOpenParties();
  const all = parties.data ?? [];
  const rooms = all.slice(0, limit);

  if (rooms.length === 0) {
    if (whenEmpty === "hide" || features.data?.watch_parties !== true) return null;
    return <PartiesInvite className={className} />;
  }

  return (
    <section aria-labelledby="open-parties" className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="open-parties" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <UsersThreeIcon size={20} weight="fill" className="text-primary" aria-hidden />
          {heading}
        </h2>
        <div className="flex shrink-0 items-baseline gap-3">
          <p className="font-mono text-xs text-muted-foreground">{partyCountLabel(all)}</p>
          <Link href="/parties" className="text-xs text-muted-foreground hover:text-primary">
            All parties &rarr;
          </Link>
        </div>
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

/**
 * The quiet-evening strip: what the rail becomes when no room is open, so
 * the feature still says it exists. One row, no poster grid — it is a
 * signpost, not a section competing with the ones that have content.
 */
export function PartiesInvite({ className }: { className?: string }) {
  return (
    <Link
      href="/parties"
      data-testid="parties-invite"
      className={cn(
        "group flex min-h-11 items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 transition-colors hover:border-primary/50 hover:bg-card",
        className,
      )}
    >
      <UsersThreeIcon size={20} weight="fill" className="shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Watch parties</span>
        <span className="block text-xs text-muted-foreground">
          No room is open right now &mdash; start one on tonight&rsquo;s episode and bring the group.
        </span>
      </span>
      <ArrowRightIcon
        size={16}
        aria-hidden
        className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
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
