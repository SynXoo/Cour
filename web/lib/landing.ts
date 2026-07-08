import type {
  AnimeSummary,
  ScheduleEntry,
  ThreadComment,
  TrendingThread,
} from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";

/** Where a trending thread lives: episode page, or the series board. */
export function threadHref(t: Pick<TrendingThread, "anime" | "episode">): string {
  return t.episode
    ? `/anime/${t.anime.id}/episode/${t.episode.number}`
    : `/anime/${t.anime.id}/discussion`;
}

/**
 * Covers for the hero poster wall. Half the picks are trending *rank* (what's
 * hot on Cour right now), half are the biggest all-time-popularity titles
 * inside that same trending pool — that's where the household names a
 * newcomer recognizes (AoT, Death Note …) surface, without adding an
 * anti-thesis hall-of-fame source. Seasonal picks fill any remainder.
 * Sequels of an already-picked title are skipped (title-prefix heuristic) so
 * the wall doesn't read as three covers of the same franchise.
 */
export function heroCovers(
  trending: AnimeSummary[],
  seasonal: AnimeSummary[],
  cap = 18,
): AnimeSummary[] {
  const byPopularity = [...trending].sort((a, b) => b.popularity - a.popularity);
  const candidates = [
    ...trending.slice(0, Math.ceil(cap / 2)),
    ...byPopularity,
    ...seasonal,
  ];

  const picked: AnimeSummary[] = [];
  const ids = new Set<number>();
  const franchise = (a: AnimeSummary) => displayTitle(a).toLowerCase();
  // "attack on titan season 2" reads as a sequel of "attack on titan", but
  // "title 10" is not a sequel of "title 1" — the base must end on a word
  // boundary (charAt past the end is "", which also catches exact-title dupes).
  const sequelOf = (title: string, base: string) =>
    title.startsWith(base) && !/[a-z0-9]/i.test(title.charAt(base.length));
  for (const a of candidates) {
    if (picked.length >= cap) break;
    if (!a.cover_image || ids.has(a.id)) continue;
    const title = franchise(a);
    if (picked.some((p) => sequelOf(title, franchise(p)))) continue;
    ids.add(a.id);
    picked.push(a);
  }
  return picked;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The next 24 hours of the schedule, plus a one-hour grace window backwards —
 * an episode that just aired is still tonight's conversation. Inert when the
 * feed only carries future entries.
 */
export function tonightEntries(entries: ScheduleEntry[], now = new Date()): ScheduleEntry[] {
  const start = now.getTime() - HOUR_MS;
  const end = now.getTime() + 24 * HOUR_MS;
  return entries.filter((e) => {
    const t = new Date(e.airing_at).getTime();
    return t >= start && t < end;
  });
}

/** "just now" / "4m ago" / "3h ago" / "2d ago" — coarse on purpose. */
export function agoLabel(iso: string, from = new Date()): string {
  const seconds = Math.max(0, Math.floor((from.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type TickerItem = {
  id: number;
  username: string;
  avatarUrl: string | null;
  body: string;
  ago: string;
  animeTitle: string;
  episode: number | null;
  href: string;
};

/**
 * Flattens the newest comments of the busiest threads into one landing-page
 * ticker feed, newest first. Spoiler-marked and deleted comments never reach
 * visitors; threads with no fetched comments contribute nothing.
 */
export function buildTicker(
  threads: TrendingThread[],
  commentsByThread: ReadonlyMap<number, ThreadComment[]>,
  now = new Date(),
  cap = 8,
): TickerItem[] {
  const items: Array<{ at: number; item: TickerItem }> = [];
  for (const t of threads) {
    for (const c of commentsByThread.get(t.thread.id) ?? []) {
      if (c.deleted || c.has_spoilers) continue;
      items.push({
        at: new Date(c.created_at).getTime(),
        item: {
          id: c.id,
          username: c.author.username,
          avatarUrl: c.author.avatar_url,
          body: c.body,
          ago: agoLabel(c.created_at, now),
          animeTitle: displayTitle(t.anime),
          episode: t.episode?.number ?? null,
          href: threadHref(t),
        },
      });
    }
  }
  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, cap)
    .map((e) => e.item);
}
