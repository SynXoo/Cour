"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip } from "@/components/ui/chip";
import { displayTitle, untilLabel } from "@/lib/anime";
import type { ScheduleEntry } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useMyList } from "@/lib/hooks/use-list";
import { applyLens, groupByDay, popularCutoff, timeLabel, type Lens } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/**
 * Day strip + lens. The strip holds seven days with a count per day under
 * the current lens; the list below is just the selected day. Lenses:
 * "My shows" (default once signed in with a non-empty week), "Popular"
 * (the top third of the week's shows — the default for visitors) and
 * "Everything". Nobody reads 118 rows; they read tonight.
 */
export function ScheduleView({ entries }: { entries: ScheduleEntry[] }) {
  const { status } = useSession();
  const { data: list } = useMyList();
  // Frozen at mount: the day buckets need one "now", and the clock is
  // impure in render.
  const [now] = useState(() => new Date());
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [lensChoice, setLensChoice] = useState<Lens | null>(null);

  const myIds = useMemo(() => new Set((list ?? []).map((e) => e.anime_id)), [list]);
  const mineCount = useMemo(() => entries.filter((e) => myIds.has(e.anime.id)).length, [entries, myIds]);
  const cutoff = useMemo(() => popularCutoff(entries), [entries]);

  const authed = status === "authed";
  const lens: Lens = lensChoice ?? (authed && mineCount > 0 ? "mine" : "popular");
  const visible = useMemo(() => applyLens(entries, lens, myIds, cutoff), [entries, lens, myIds, cutoff]);
  const days = useMemo(() => groupByDay(visible, now), [visible, now]);
  const selected = days.find((d) => d.key === dayKey) ?? days[0];

  const distinctShows = new Set(entries.map((e) => e.anime.id)).size;
  const popularShows = new Set(applyLens(entries, "popular", myIds, cutoff).map((e) => e.anime.id)).size;

  const lenses: { id: Lens; label: string; count: number }[] = [
    ...(authed ? [{ id: "mine" as const, label: "My shows", count: mineCount }] : []),
    { id: "popular", label: "Popular", count: applyLens(entries, "popular", myIds, cutoff).length },
    { id: "all", label: "Everything", count: entries.length },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which shows">
          {lenses.map((l) => (
            <Chip key={l.id} active={lens === l.id} onClick={() => setLensChoice(l.id)}>
              {l.label}
              <span className={cn("font-mono text-[11px]", lens === l.id ? "opacity-80" : "opacity-60")}>{l.count}</span>
            </Chip>
          ))}
        </div>
        <p className="ml-auto text-xs text-muted-foreground" data-testid="lens-note">
          {lens === "mine"
            ? `${mineCount} episode${mineCount === 1 ? "" : "s"} of your shows this week`
            : lens === "popular"
              ? `The ${popularShows} most popular of ${distinctShows} shows airing this week`
              : `Every one of ${distinctShows} shows airing this week`}
        </p>
      </div>

      <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Days">
        {days.map((d) => {
          const active = d.key === selected.key;
          return (
            <li key={d.key} className="shrink-0">
              <button
                type="button"
                onClick={() => setDayKey(d.key)}
                aria-pressed={active}
                className={cn(
                  "flex w-[4.75rem] flex-col items-center rounded-2xl border px-2 py-2 transition-colors",
                  active
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/60 bg-card text-muted-foreground hover:border-primary/40",
                )}
              >
                <span className="text-xs font-medium">{d.label}</span>
                <span className="font-mono text-[10px]">{d.date}</span>
                <span
                  className={cn(
                    "mt-1 font-mono text-sm font-semibold tabular-nums",
                    d.entries.length === 0 ? "text-muted-foreground/60" : active ? "text-primary" : "text-foreground",
                  )}
                >
                  {d.entries.length}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <section aria-label={`${selected.label}, ${selected.date}`} className="space-y-2">
        {selected.entries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
            {lens === "mine" ? (
              <>
                None of your shows air {selected.label === "Today" ? "today" : `on ${selected.label}`} —{" "}
                <button type="button" onClick={() => setLensChoice("popular")} className="underline underline-offset-4 hover:text-foreground">
                  see what&apos;s popular
                </button>
                .
              </>
            ) : (
              "Nothing airs that day."
            )}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
            {selected.entries.map((e) => {
              const aired = new Date(e.airing_at).getTime() <= now.getTime();
              const mine = myIds.has(e.anime.id);
              return (
                <li key={`${e.anime.id}-${e.episode}`}>
                  <Link
                    href={`/anime/${e.anime.id}/episode/${e.episode}`}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40"
                  >
                    <span className="w-16 shrink-0 font-mono text-sm font-semibold tabular-nums text-gold">
                      {timeLabel(e.airing_at)}
                    </span>
                    <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
                      {e.anime.cover_image && (
                        <Image src={e.anime.cover_image} alt="" fill sizes="36px" className="object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{displayTitle(e.anime)}</span>
                        {mine && (
                          <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px font-mono text-[10px] text-primary">
                            yours
                          </span>
                        )}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        Episode {e.episode} ·{" "}
                        {aired ? <span className="text-live">aired · room open</span> : untilLabel(e.airing_at)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">Room →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
