"use client";

import { UsersThreeIcon } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { animeHref, displayTitle } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";
import { useFeatures } from "@/lib/hooks/use-features";
import { useParty, type PartyConnection } from "@/lib/hooks/use-party";
import { errorCopy, presenceLabel, type PartyMember, type WatchParty } from "@/lib/parties";
import { cn } from "@/lib/utils";

/**
 * The room (M4.1): who is here, live. The header names the episode, the
 * pill says whether the socket is live, and the roster updates as members
 * come and go. No player, no stream — the page is deliberately explicit
 * about that. The shared clock (M4.2) and chat (M4.3) mount below this.
 */
export function PartyClient({ partyId }: { partyId: number }) {
  const { status, user } = useSession();
  const features = useFeatures();
  const enabled = status === "authed" && features.data?.watch_parties === true;
  const { connection, room } = useParty(partyId, enabled);

  if (features.data && !features.data.watch_parties) {
    return (
      <Empty title="Watch parties aren't on here">
        This Cour doesn&rsquo;t have watch parties switched on yet.
      </Empty>
    );
  }

  if (status === "anon") {
    return (
      <Empty title="Watch party">
        A room where a few people watch the same episode at the same time — sign in to join.
        <div className="pt-2">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </Empty>
    );
  }

  const { party, members, error } = room;

  if (error && !party) {
    return <Empty title="Can’t join this party">{errorCopy(error, null)}</Empty>;
  }

  if (!party) {
    return (
      <div className="flex flex-col gap-6 py-2" aria-busy>
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-14 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  const { anime, episode, host } = party;
  const episodeHref = `/anime/${anime.id}/episode/${episode.number}`;
  const ended = party.closed_at != null || error?.code === "conflict";
  const includesViewer = members.some((m) => m.username === user?.username);

  return (
    <div className="flex flex-col gap-6 py-2">
      <header className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Link
            href={animeHref(anime)}
            className="relative h-20 w-14 shrink-0 overflow-hidden rounded bg-muted"
          >
            {anime.cover_image && (
              <Image src={anime.cover_image} alt="" fill sizes="56px" className="object-cover" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold tracking-wide text-primary uppercase">
              <UsersThreeIcon size={14} weight="fill" aria-hidden />
              Watch party
            </p>
            <h1 className="truncate text-xl font-bold tracking-tight">
              {displayTitle(anime)}
            </h1>
            <p className="text-sm text-muted-foreground">
              <Link href={episodeHref} className="hover:text-primary">
                Episode {episode.number}
                {episode.title ? ` — ${episode.title}` : ""}
              </Link>
              {" · "}hosted by{" "}
              <Link href={`/users/${host.username}`} className="hover:text-primary">
                @{host.username}
              </Link>
            </p>
          </div>
        </div>
        <ConnectionPill connection={ended ? "closed" : connection} ended={ended} />
      </header>

      {error && (
        <p
          role="status"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm"
        >
          {errorCopy(error, host.username)}{" "}
          <Link href={episodeHref} className="font-medium underline-offset-4 hover:underline">
            Open the episode thread →
          </Link>
        </p>
      )}

      <Roster party={party} members={members} includesViewer={includesViewer} />

      <p className="text-xs text-muted-foreground">
        Bring your own legal stream — Cour never hosts or links to video. A party syncs
        people: who&rsquo;s here now, and soon a shared clock and live chat.
      </p>
    </div>
  );
}

function Roster({
  party,
  members,
  includesViewer,
}: {
  party: WatchParty;
  members: PartyMember[];
  includesViewer: boolean;
}) {
  return (
    <section aria-label="Who's here" className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Here now</h2>
        <p className="font-mono text-xs text-muted-foreground" data-testid="presence">
          {presenceLabel(members.length, includesViewer)}
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {members.map((m) => {
          const isHost = m.username === party.host.username;
          return (
            <li key={m.id}>
              <Link
                href={`/users/${m.username}`}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm transition-colors hover:border-primary/50 md:min-h-0",
                  isHost && "border-primary/40 bg-primary/5",
                )}
              >
                <Avatar className="h-8 w-8 text-xs">
                  {m.avatar_url && <AvatarImage src={m.avatar_url} alt="" />}
                  <AvatarFallback>{m.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="max-w-[10rem] truncate">@{m.username}</span>
                {isHost && (
                  <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold tracking-wide text-primary-foreground uppercase">
                    Host
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {members.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Waiting for the room to fill in&hellip;
        </p>
      )}
    </section>
  );
}

const PILL: Record<PartyConnection, { label: string; className: string; pulse: boolean }> = {
  connecting: { label: "Connecting", className: "border-border text-muted-foreground", pulse: false },
  live: { label: "Live", className: "border-live/40 bg-live/10 text-live", pulse: true },
  reconnecting: {
    label: "Reconnecting",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    pulse: false,
  },
  closed: { label: "Ended", className: "border-border text-muted-foreground", pulse: false },
};

function ConnectionPill({ connection, ended }: { connection: PartyConnection; ended: boolean }) {
  const pill = PILL[connection];
  const label = ended ? "Ended" : pill.label;
  return (
    <span
      role="status"
      aria-live="polite"
      data-connection={connection}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wide uppercase",
        pill.className,
      )}
    >
      {pill.pulse && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
        </span>
      )}
      {label}
    </span>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="max-w-sm text-sm text-muted-foreground">{children}</div>
    </section>
  );
}
