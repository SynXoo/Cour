import Image from "next/image";
import Link from "next/link";
import type { ScheduleEntry } from "@/lib/api/client";
import { displayTitle, untilLabel } from "@/lib/anime";

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The week's airing schedule, grouped into a section per day. Shared, so both
 * the server-rendered full view and the client "my shows only" view render it
 * identically. Entries are assumed pre-sorted by airing time.
 */
export function ScheduleDays({ entries }: { entries: ScheduleEntry[] }) {
  const byDay = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const key = dayKey(e.airing_at);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  return (
    <>
      {[...byDay.entries()].map(([day, dayEntries]) => (
        <section key={day} aria-label={day} className="space-y-3">
          <h2 className="sticky top-14 z-10 -mx-4 border-b border-border/60 bg-background/90 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
            {day}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {dayEntries.map((e) => (
              // min-w-0 lets the grid item shrink so the title can truncate
              // instead of forcing the card wider than its column.
              <li key={`${e.anime.id}-${e.episode}`} className="min-w-0">
                <Link
                  href={`/anime/${e.anime.id}/episode/${e.episode}`}
                  className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-2.5 transition-colors hover:border-primary/50"
                >
                  <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-primary">
                    {timeLabel(e.airing_at)}
                  </span>
                  <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-muted">
                    {e.anime.cover_image && (
                      <Image src={e.anime.cover_image} alt="" fill sizes="40px" className="object-cover" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{displayTitle(e.anime)}</p>
                    <p className="text-xs text-muted-foreground">
                      Episode {e.episode} · {untilLabel(e.airing_at)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
