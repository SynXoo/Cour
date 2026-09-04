"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { displayTitle } from "@/lib/anime";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { agoLabel } from "@/lib/landing";
import {
  badgeTone,
  roomHref,
  roomLabel,
  streakMessage,
  weekLetters,
  type Pulse,
  type Streak,
} from "@/lib/pulse";
import { cn } from "@/lib/utils";

/**
 * "Your pulse" (§M3.8): the block that makes the home worth reopening.
 * Three cards — the streak (with the seven-day dots and a sentence that
 * always says what to do next), badges earned plus the closest one
 * unearned, and what other people did to *you* since last time (replies
 * to your comments, reactions your comments drew). All personal, so it's
 * a client island over the viewer's token; the server renders a skeleton.
 */

const MAX_BADGES_SHOWN = 6;
const MAX_REPLIES_SHOWN = 3;

function usePulse() {
  const { status } = useSession();
  return useQuery({
    queryKey: ["pulse"],
    enabled: status === "authed",
    staleTime: 60_000,
    queryFn: async (): Promise<Pulse> => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await browserApi.GET("/me/pulse", { params: { query: { tz } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });
}

export function PulseBlock() {
  const { status, user } = useSession();
  const { data, isPending } = usePulse();
  // Frozen at mount: the week letters only need today's date once.
  const [today] = useState(() => new Date());

  if (status !== "authed") return null;

  return (
    <section aria-labelledby="pulse" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="pulse" className="text-lg font-semibold tracking-tight">
          Your <span className="text-primary">pulse</span>
        </h2>
        {user && (
          <Link
            href={`/users/${user.username}`}
            className="text-sm text-muted-foreground hover:text-primary"
          >
            Profile →
          </Link>
        )}
      </div>
      {isPending || !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          <StreakCard streak={data.streak} today={today} />
          <BadgesCard pulse={data} />
          <RepliesCard pulse={data} />
        </div>
      )}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function StreakCard({ streak, today }: { streak: Streak; today: Date }) {
  const letters = weekLetters(today);
  const alive = streak.current > 0;
  const personalBest = alive && streak.current >= 3 && streak.current >= streak.best;
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border bg-card p-4",
        alive ? "border-live/30" : "border-border/60",
      )}
      data-testid="streak-card"
    >
      {alive && <div aria-hidden className="pulse-glow absolute inset-0 -z-10" />}
      <Eyebrow>
        <span>Streak</span>
        {streak.best > 0 && <span className="normal-case tracking-normal">Best {streak.best}</span>}
      </Eyebrow>
      <p className="mt-1 flex items-baseline gap-2">
        <span
          className={cn("text-4xl font-bold tabular-nums tracking-tight", alive && "text-live")}
          data-testid="streak-current"
        >
          {alive && (
            <span aria-hidden className="mr-1 text-2xl">
              🔥
            </span>
          )}
          {streak.current}
        </span>
        <span className="text-sm text-muted-foreground">day{streak.current === 1 ? "" : "s"}</span>
        {personalBest && (
          <span className="rounded-full border border-live/30 bg-live/10 px-2 py-0.5 font-mono text-[10px] text-live">
            personal best
          </span>
        )}
      </p>
      <ol className="mt-3 flex gap-2" aria-label="Last seven days">
        {streak.week.map((on, i) => (
          <li key={i} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                on ? "bg-live" : "bg-muted",
                i === 6 && !on && "ring-1 ring-live/60 ring-offset-1 ring-offset-card",
              )}
              aria-label={on ? "active" : "quiet"}
            />
            <span className="font-mono text-[10px] text-muted-foreground">{letters[i]}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">{streakMessage(streak)}</p>
    </div>
  );
}

function BadgesCard({ pulse }: { pulse: Pulse }) {
  const { badges, next_badge: next } = pulse;
  const shown = badges.slice(0, MAX_BADGES_SHOWN);
  const pct = next ? Math.min(100, Math.round((next.progress / next.target) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4" data-testid="badges-card">
      <Eyebrow>
        <span>Badges</span>
        <span className="normal-case tracking-normal">{badges.length} earned</span>
      </Eyebrow>
      {shown.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((b) => (
            <li
              key={b.id}
              title={b.description}
              className={cn("rounded-full border px-2 py-0.5 font-mono text-[11px]", badgeTone(b.tier))}
            >
              {b.label}
            </li>
          ))}
          {badges.length > shown.length && (
            <li className="rounded-full border border-border/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              +{badges.length - shown.length}
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing yet — the first one is one comment away.
        </p>
      )}
      {next && (
        <div className="mt-3" data-testid="next-badge">
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              Next: <span className="font-medium text-foreground">{next.label}</span>
            </span>
            <span className="font-mono text-muted-foreground">
              {next.progress}/{next.target}
            </span>
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{next.description}</p>
        </div>
      )}
    </div>
  );
}

function RepliesCard({ pulse }: { pulse: Pulse }) {
  const { replies, kudos } = pulse;
  const shown = replies.slice(0, MAX_REPLIES_SHOWN);
  return (
    <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-4" data-testid="replies-card">
      <Eyebrow>
        <span>Replies to you</span>
        {kudos.reactions_week > 0 && (
          <span className="normal-case tracking-normal text-live">
            {kudos.reactions_week} reaction{kudos.reactions_week === 1 ? "" : "s"} this week
          </span>
        )}
      </Eyebrow>
      {shown.length > 0 ? (
        <ul className="mt-1 divide-y divide-border/60">
          {shown.map((r) => (
            <li key={r.comment_id}>
              <Link
                href={roomHref(r.anime.id, r.kind, r.episode)}
                className="group flex items-start gap-2.5 py-2"
              >
                <Avatar className="mt-0.5 h-7 w-7">
                  {r.actor.avatar_url && <AvatarImage src={r.actor.avatar_url} alt="" />}
                  <AvatarFallback className="text-[10px]">
                    {r.actor.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">@{r.actor.username}</span>
                    {" · "}
                    {displayTitle(r.anime)} · {roomLabel(r.kind, r.episode)} ·{" "}
                    {agoLabel(r.created_at)}
                  </p>
                  <p className="truncate text-sm group-hover:text-primary">{r.snippet}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Nobody has replied yet — say something in tonight&apos;s room and check back.
        </p>
      )}
      {kudos.top && (
        <p className="mt-auto border-t border-border/60 pt-2 text-xs text-muted-foreground">
          Most reacted this week:{" "}
          <Link
            href={roomHref(kudos.top.anime.id, kudos.top.kind, kudos.top.episode)}
            className="text-foreground hover:text-primary"
          >
            &ldquo;{kudos.top.snippet}&rdquo;
          </Link>{" "}
          · <span className="text-live">{kudos.top.reactions}</span> on{" "}
          {displayTitle(kudos.top.anime)}
        </p>
      )}
    </div>
  );
}
