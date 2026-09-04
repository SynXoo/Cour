import type { ScheduleEntry } from "@/lib/api/client";

/**
 * Pure helpers behind the schedule page (§M3.8): a day strip instead of one
 * long wall, and a "lens" that trims the week to the shows a person could
 * plausibly care about.
 */

export type Lens = "mine" | "popular" | "all";

export type DayBucket = {
  /** YYYY-MM-DD in the viewer's zone — the strip's key. */
  key: string;
  /** "Today" / "Tomorrow" / "Wed" */
  label: string;
  /** "Sep 4" */
  date: string;
  entries: ScheduleEntry[];
};

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Seven consecutive days starting today, each with its episodes (soonest
 * first). Days with nothing airing still exist — an empty column is
 * information ("nothing tonight"), a missing one is a bug report.
 */
export function groupByDay(entries: ScheduleEntry[], now = new Date(), days = 7): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : weekday.format(d);
    buckets.set(dayKey(d), { key: dayKey(d), label, date: monthDay.format(d), entries: [] });
  }
  const sorted = [...entries].sort(
    (a, b) => new Date(a.airing_at).getTime() - new Date(b.airing_at).getTime(),
  );
  for (const e of sorted) {
    buckets.get(dayKey(new Date(e.airing_at)))?.entries.push(e);
  }
  return [...buckets.values()];
}

/**
 * The popularity floor for the "popular" lens: the top third of the week's
 * distinct shows. Relative, so a thin week still has a list and a packed
 * one doesn't drown the reader.
 */
export function popularCutoff(entries: ScheduleEntry[]): number {
  const pops = [...new Map(entries.map((e) => [e.anime.id, e.anime.popularity])).values()].sort(
    (a, b) => b - a,
  );
  if (pops.length === 0) return 0;
  const idx = Math.min(pops.length - 1, Math.max(0, Math.ceil(pops.length / 3) - 1));
  return pops[idx];
}

/** Apply a lens to the week. `mine` needs the viewer's list ids. */
export function applyLens(
  entries: ScheduleEntry[],
  lens: Lens,
  myIds: ReadonlySet<number>,
  cutoff = popularCutoff(entries),
): ScheduleEntry[] {
  switch (lens) {
    case "mine":
      return entries.filter((e) => myIds.has(e.anime.id));
    case "popular":
      return entries.filter((e) => e.anime.popularity >= cutoff);
    default:
      return entries;
  }
}

/** Local "9:30 PM" for a row. */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
