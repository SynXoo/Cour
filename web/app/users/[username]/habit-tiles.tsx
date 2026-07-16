"use client";

import Link from "next/link";
import { animeHref, displayTitle } from "@/lib/anime";
import {
  completionRate,
  dropRate,
  meanEpisodesPerShow,
  type ProfileStats,
  type UserProfile,
} from "@/lib/profile";

/**
 * The reading-between-the-lines row: do they finish what they start, how deep
 * do they go, whose animation are they really watching, and how far back does
 * the shelf reach. Every tile is derived — no tile renders on a shelf that
 * can't support it, so a fresh profile shows none of them rather than a wall
 * of zeroes and dashes.
 */
export function HabitTiles({
  stats,
  longestCompleted,
}: {
  stats: ProfileStats;
  longestCompleted: UserProfile["stats"]["longest_completed"];
}) {
  const total =
    stats.counts.watching +
    stats.counts.completed +
    stats.counts.planning +
    stats.counts.paused +
    stats.counts.dropped;

  const finished = completionRate(stats.counts);
  const dropped = dropRate(stats.counts);
  const perShow = meanEpisodesPerShow(stats.episodes_watched, total);
  const topStudio = stats.top_studios[0];
  const span = stats.library_span;

  const tiles = [
    finished !== null && {
      key: "finished",
      label: "Follow-through",
      value: `${Math.round(finished * 100)}%`,
      hint: "of the shows you started and stopped",
    },
    dropped !== null &&
      dropped > 0 && {
        key: "dropped",
        label: "Drop rate",
        value: `${Math.round(dropped * 100)}%`,
        hint: "walked away from",
      },
    perShow !== null && {
      key: "per-show",
      label: "Episodes per show",
      value: perShow.toFixed(1),
      hint: `across ${total} on the shelves`,
    },
    topStudio && {
      key: "studio",
      label: "House studio",
      value: topStudio.name,
      hint: `${topStudio.count} ${topStudio.count === 1 ? "show" : "shows"} in the library`,
    },
    span && {
      key: "span",
      label: "Shelf reaches back to",
      value: String(span.earliest_year),
      hint:
        span.earliest_year === span.latest_year
          ? "a single year, so far"
          : `${span.latest_year - span.earliest_year} years of anime`,
    },
  ].filter((t): t is { key: string; label: string; value: string; hint: string } => Boolean(t));

  if (tiles.length === 0 && !longestCompleted) return null;

  return (
    <div className="space-y-4">
      <h3 className="tint-ink text-sm font-semibold uppercase tracking-wide">Habits</h3>

      {tiles.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.key} className="min-w-0">
              <dd className="tint-ink truncate font-mono text-xl font-bold tabular-nums" title={t.value}>
                {t.value}
              </dd>
              <dt className="text-xs font-medium">{t.label}</dt>
              <p className="text-xs text-muted-foreground">{t.hint}</p>
            </div>
          ))}
        </dl>
      )}

      {longestCompleted && (
        <Link
          href={animeHref(longestCompleted)}
          className="group flex items-baseline gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>Longest series finished:</span>
          <span className="tint-ink truncate font-medium group-hover:underline">
            {displayTitle(longestCompleted)}
          </span>
          {longestCompleted.episodes_count != null && (
            <span className="shrink-0 font-mono text-xs tabular-nums">
              {longestCompleted.episodes_count} ep
            </span>
          )}
        </Link>
      )}
    </div>
  );
}
