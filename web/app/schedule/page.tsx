import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { serverApi, type ScheduleEntry } from "@/lib/api/client";
import { displayTitle, untilLabel } from "@/lib/anime";

export const metadata: Metadata = {
  title: "Weekly Schedule",
  description: "What's airing this week, day by day — with a discussion thread for every episode.",
};

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

export default async function SchedulePage() {
  const res = await serverApi().GET("/schedule", {}).catch(() => null);
  const entries = res?.data?.data ?? [];

  const byDay = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const key = dayKey(e.airing_at);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  return (
    <PageShell width="browse" className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">This week</h1>
        <p className="text-sm text-muted-foreground">
          Every episode airing in the next 7 days. Times are your local time.
        </p>
      </header>

      {byDay.size === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-muted-foreground">
          No schedule synced yet — run <code className="rounded bg-muted px-1.5 py-0.5">task seed</code> or wait for the airing sync.
        </p>
      ) : (
        [...byDay.entries()].map(([day, dayEntries]) => (
          <section key={day} aria-label={day} className="space-y-3">
            <h2 className="sticky top-14 z-10 -mx-4 border-b border-border/60 bg-background/90 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              {day}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {dayEntries.map((e) => (
                <li key={`${e.anime.id}-${e.episode}`}>
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
        ))
      )}
    </PageShell>
  );
}
