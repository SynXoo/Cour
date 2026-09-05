"use client";

import {
  BroadcastIcon,
  ChatCircleDotsIcon,
  ClockCountdownIcon,
  MonitorPlayIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Countdown } from "@/app/home/countdown";
import { PartyCard, partyCountLabel } from "@/components/parties/open-parties";
import { useFeatures } from "@/lib/hooks/use-features";
import { useOpenParties } from "@/lib/hooks/use-parties";
import type { HostableEpisode } from "@/lib/parties-hub";

/**
 * The `/parties` hub. Everything live here is client-side for the same
 * reason the rails are — the visible rooms depend on who is asking — but
 * unlike the rails this surface never renders empty: an evening with no
 * open room becomes the pitch plus a list of episodes to start one on.
 * That is the whole point of the page. Parties were reachable only from
 * two conditional rails and a control buried on episode pages, so on a
 * quiet night the feature did not appear to exist at all.
 */
export function PartiesHub({ episodes }: { episodes: HostableEpisode[] }) {
  const features = useFeatures();
  const parties = useOpenParties();
  const rooms = parties.data ?? [];

  // The order is the server's (see `hostableEpisodes`); this clock read —
  // frozen at mount, the purity-safe spot for one — only decides each row's
  // label, so a page cached a minute ago can't call a live episode "soon".
  const [nowMs] = useState(() => Date.now());
  const off = features.data?.watch_parties === false;

  return (
    <div className="flex flex-col gap-8">
      <LiveStats rooms={rooms.length} watching={rooms.reduce((n, p) => n + p.watching, 0)} off={off} />

      {off ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          Watch parties are switched off on this deployment
          (<code className="rounded bg-muted px-1.5 py-0.5">FEATURE_WATCH_PARTIES</code>).
        </p>
      ) : (
        <>
          <section aria-labelledby="open-now" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="open-now" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <span className="relative flex h-2 w-2">
                  {rooms.length > 0 && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
                  )}
                  <span
                    className={`relative inline-flex h-2 w-2 rounded-full ${rooms.length > 0 ? "bg-live" : "bg-muted-foreground/40"}`}
                  />
                </span>
                Open right now
              </h2>
              {rooms.length > 0 && (
                <p className="font-mono text-xs text-muted-foreground">{partyCountLabel(rooms)}</p>
              )}
            </div>

            {rooms.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No room is open at the moment. Pick an episode below and be the host &mdash;
                anyone you follow will see it here the moment it opens.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {rooms.map((p) => (
                  <li key={p.id}>
                    <PartyCard party={p} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <HowAPartyWorks />

          {episodes.length > 0 && (
            <section aria-labelledby="start-one" className="space-y-3">
              <div className="space-y-1">
                <h2 id="start-one" className="text-lg font-semibold tracking-tight">
                  Start one on tonight&rsquo;s episodes
                </h2>
                <p className="text-sm text-muted-foreground">
                  Out in the last day, freshest first &mdash; then what&rsquo;s still to come.
                </p>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {episodes.slice(0, 12).map((ep) => (
                  <li key={`${ep.animeId}:${ep.episode}`}>
                    <StartRow episode={ep} aired={new Date(ep.airingAt).getTime() <= nowMs} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** The header's live numbers — the page's proof that this is a real room, not a concept. */
function LiveStats({ rooms, watching, off }: { rooms: number; watching: number; off: boolean }) {
  if (off) return null;
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 border-y border-border/60 py-3 font-mono text-xs text-muted-foreground">
      <div>
        <dt className="sr-only">Rooms open</dt>
        <dd>
          <span className={`text-base font-semibold ${rooms > 0 ? "text-live" : "text-foreground"}`}>
            {rooms}
          </span>{" "}
          {rooms === 1 ? "room" : "rooms"} open
        </dd>
      </div>
      <div>
        <dt className="sr-only">People watching together</dt>
        <dd>
          <span className={`text-base font-semibold ${watching > 0 ? "text-live" : "text-foreground"}`}>
            {watching}
          </span>{" "}
          watching together
        </dd>
      </div>
    </dl>
  );
}

const MECHANICS = [
  {
    icon: ClockCountdownIcon,
    accent: "text-primary",
    title: "One shared clock",
    body: "The host hits play, pauses, jumps to 12:34 — everyone's timer follows, corrected for drift.",
  },
  {
    icon: ChatCircleDotsIcon,
    accent: "text-live",
    title: "Live chat and reactions",
    body: "Talk as it happens. Reactions are anchored to the second and can persist into the episode thread.",
  },
  {
    icon: BroadcastIcon,
    accent: "text-gold",
    title: "Presence, not permission",
    body: "See who's in the room and who just walked in. Public, followers-only, or friends — your call per party.",
  },
  {
    icon: MonitorPlayIcon,
    accent: "text-muted-foreground",
    title: "Your own stream",
    body: "Cour never hosts, proxies or links to video. A party synchronises people; everyone brings their own legal source.",
  },
];

/** The pitch. Always on the page — it is the answer to "what even is this?". */
function HowAPartyWorks() {
  return (
    <section aria-labelledby="how-parties-work" className="space-y-3">
      <h2 id="how-parties-work" className="text-lg font-semibold tracking-tight">
        How a party works
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {MECHANICS.map((m) => (
          <li key={m.title} className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <m.icon size={18} weight="fill" className={m.accent} aria-hidden />
              {m.title}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{m.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One episode you could host tonight. The link lands on the episode page,
 * where the launcher already owns starting a room (visibility picker and
 * the rooms already open on that episode) — one start flow, not two.
 */
function StartRow({ episode, aired }: { episode: HostableEpisode; aired: boolean }) {
  return (
    <Link
      href={episode.href}
      className="tint-card flex h-full min-h-11 items-center gap-3 rounded-lg border p-2 pr-3 transition-colors hover:border-primary/50"
      style={
        episode.coverColor ? ({ "--tint": episode.coverColor } as React.CSSProperties) : undefined
      }
    >
      <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-muted">
        {episode.cover && (
          <Image src={episode.cover} alt="" fill sizes="40px" className="object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{episode.title}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          Ep {episode.episode} ·{" "}
          {aired ? (
            <span className="text-live">out now</span>
          ) : (
            <Countdown iso={episode.airingAt} className="text-gold" />
          )}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {aired ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <UsersThreeIcon size={14} weight="fill" aria-hidden />
            Start
          </span>
        ) : (
          "Soon"
        )}
      </span>
    </Link>
  );
}
