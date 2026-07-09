import type { AnimeSummary, ScheduleEntry, TrendingThread } from "@/lib/api/client";
import type { ListEntryWithAnime } from "@/lib/hooks/use-list";
import { threadHref, tonightEntries } from "@/lib/landing";

/**
 * Pure joins and filters behind the signed-in home ("Tonight on Cour").
 * Everything here is data → data so the evening/continue/conversation rows
 * are unit-testable without mounting the islands that render them.
 */

/** Time-of-day salutation; the hour comes from the viewer's clock. */
export function greetingFor(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The viewer's slice of tonight: schedule entries inside the landing's
 * tonight window (next 24 h + the 1 h just-aired grace) restricted to shows
 * on their watching list, soonest first — so a just-aired episode (negative
 * delta) outranks everything: that room is live *right now*.
 */
export function myTonight(
  schedule: ScheduleEntry[],
  watchingIds: ReadonlySet<number>,
  now = new Date(),
): ScheduleEntry[] {
  return tonightEntries(schedule, now)
    .filter((e) => watchingIds.has(e.anime.id))
    .sort((a, b) => new Date(a.airing_at).getTime() - new Date(b.airing_at).getTime());
}

/**
 * The quiet-night fallback: when nothing of yours airs tonight, the nearest
 * upcoming episode per watched show beyond the tonight window (the schedule
 * feed spans ~7 days). One entry per anime, soonest first.
 */
export function nextUpLater(
  schedule: ScheduleEntry[],
  watchingIds: ReadonlySet<number>,
  now = new Date(),
  cap = 8,
): ScheduleEntry[] {
  const horizon = now.getTime() + 24 * 60 * 60 * 1000;
  const seen = new Set<number>();
  const out: ScheduleEntry[] = [];
  const later = schedule
    .filter((e) => watchingIds.has(e.anime.id) && new Date(e.airing_at).getTime() >= horizon)
    .sort((a, b) => new Date(a.airing_at).getTime() - new Date(b.airing_at).getTime());
  for (const e of later) {
    if (out.length >= cap) break;
    if (seen.has(e.anime.id)) continue;
    seen.add(e.anime.id);
    out.push(e);
  }
  return out;
}

export type ContinueRow = {
  anime: AnimeSummary;
  /** Current list progress. */
  progress: number;
  /** The next unwatched episode — what "+1" marks and "Discuss" opens. */
  nextEp: number;
  /** Total episodes when known. */
  total: number | null;
};

/**
 * Shows with an unwatched-but-watchable next episode. "Watchable" respects
 * airing reality: an airing show caps at the last aired episode
 * (next_airing_episode − 1), a finished show at its episode count, and a
 * not-yet-released show has nothing to continue. Unknown data stays
 * permissive — a watching entry with no airing info still deserves its row.
 * Most-recently-updated first: the show you're actively bingeing leads.
 */
export function continueWatching(entries: ListEntryWithAnime[], cap = 12): ContinueRow[] {
  const rows: (ContinueRow & { updatedAt: number })[] = [];
  for (const e of entries) {
    if (e.status !== "watching") continue;
    const a = e.anime;
    const nextEp = e.progress + 1;
    const aired =
      a.next_airing_episode != null
        ? a.next_airing_episode - 1
        : a.status === "NOT_YET_RELEASED"
          ? 0
          : (a.episodes_count ?? Number.POSITIVE_INFINITY);
    const watchable = Math.min(aired, a.episodes_count ?? Number.POSITIVE_INFINITY);
    if (nextEp > watchable) continue;
    rows.push({
      anime: a,
      progress: e.progress,
      nextEp,
      total: a.episodes_count,
      updatedAt: new Date(e.updated_at).getTime(),
    });
  }
  return rows
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .slice(0, cap)
    .map((r) => ({ anime: r.anime, progress: r.progress, nextEp: r.nextEp, total: r.total }));
}

/**
 * Split the (all-catalog) trending list into the current season's titles and
 * the revivals — older shows the conversation pulled back up. Titles without
 * season data ride the main row; the revival label must be provable.
 */
export function splitConversation(
  trending: AnimeSummary[],
  season: string,
  year: number,
): { current: AnimeSummary[]; revival: AnimeSummary[] } {
  const current: AnimeSummary[] = [];
  const revival: AnimeSummary[] = [];
  for (const a of trending) {
    const dated = a.season != null && a.season_year != null;
    if (dated && !(a.season === season && a.season_year === year)) revival.push(a);
    else current.push(a);
  }
  return { current, revival };
}

export type AnimeTalkStats = {
  /** Comments inside the trending window, summed across the show's threads. */
  recent: number;
  /** Live readers right now, summed across the show's threads. */
  presence: number;
  /** All-time comments across the show's trending threads. */
  comments: number;
  /** The show's hottest room (trending order). */
  href: string;
  /** "Ep 9 thread" | "Series talk" for that hottest room. */
  label: string;
};

/** Per-anime aggregate of the trending-thread stats, hottest thread first. */
export function talkStatsByAnime(threads: TrendingThread[]): Record<number, AnimeTalkStats> {
  const out: Record<number, AnimeTalkStats> = {};
  for (const t of threads) {
    const cur = out[t.anime.id];
    if (cur) {
      cur.recent += t.recent_comments;
      cur.presence += t.presence;
      cur.comments += t.thread.comment_count;
    } else {
      out[t.anime.id] = {
        recent: t.recent_comments,
        presence: t.presence,
        comments: t.thread.comment_count,
        href: threadHref(t),
        label: t.episode ? `Ep ${t.episode.number} thread` : "Series talk",
      };
    }
  }
  return out;
}

/** Per-episode room stats for the evening cards, keyed `${animeId}:${ep}`. */
export function roomStatsByEpisode(
  threads: TrendingThread[],
): Record<string, { presence: number; comments: number }> {
  const out: Record<string, { presence: number; comments: number }> = {};
  for (const t of threads) {
    if (!t.episode) continue;
    out[`${t.anime.id}:${t.episode.number}`] = {
      presence: t.presence,
      comments: t.thread.comment_count,
    };
  }
  return out;
}

/** The header's one-line site pulse: activity summed over the hot threads. */
export function pulseStats(threads: TrendingThread[]): { recent: number; presence: number } {
  return threads.reduce(
    (acc, t) => ({
      recent: acc.recent + t.recent_comments,
      presence: acc.presence + t.presence,
    }),
    { recent: 0, presence: 0 },
  );
}
