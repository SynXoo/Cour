"use client";

import type { CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProfileStats } from "@/lib/profile";

// A mean resting on one or two ratings is an accident, not a preference.
const MIN_RATED_FOR_MEAN = 3;

/**
 * The genre breakdown, kept from the old profile but tinted and clickable:
 * each bar filters the library below to that genre. Fills sweep in once on
 * mount (`.genre-fill`, off under reduced motion).
 *
 * Count is only half the story — you watch a lot of Action and *love* the two
 * Thrillers you tried. So each bar also carries a notch at the owner's mean
 * score for the genre, positioned on a 1-10 axis across the bar.
 */
export function GenreBars({
  genres,
  onPick,
}: {
  genres: ProfileStats["genres"];
  onPick: (genre: string) => void;
}) {
  const max = Math.max(1, ...genres.map((g) => g.count));

  return (
    <TooltipProvider>
      <ul className="flex flex-col gap-0.5">
        {genres.map((g, i) => {
          const showMean = g.mean_score != null && g.rated_count >= MIN_RATED_FOR_MEAN;
          return (
            <li key={g.genre}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onPick(g.genre)}
                    className="group flex h-11 w-full items-center gap-2 rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7"
                    aria-label={
                      showMean
                        ? `${g.count} ${g.genre} shows, rated ${g.mean_score!.toFixed(1)} on average — see them below`
                        : `${g.count} ${g.genre} shows — see them below`
                    }
                  >
                    <span className="w-28 shrink-0 truncate text-left text-muted-foreground group-hover:text-foreground">
                      {g.genre}
                    </span>
                    <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        style={{ width: `${Math.max(4, (g.count / max) * 100)}%`, "--i": i } as CSSProperties}
                        className="genre-fill tint-fill absolute inset-y-0 left-0 rounded-full transition-opacity group-hover:opacity-80"
                      />
                      {showMean && (
                        // Notch rides the 1-10 axis, not the count axis: it
                        // says *how well* rated, wherever the bar happens to end.
                        <span
                          aria-hidden
                          style={{ left: `${(g.mean_score! / 10) * 100}%` }}
                          className="absolute inset-y-[-2px] w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
                        />
                      )}
                    </span>
                    <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {g.count}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {g.count} {g.genre} {g.count === 1 ? "show" : "shows"}
                  {showMean
                    ? ` · rated ${g.mean_score!.toFixed(1)} across ${g.rated_count}`
                    : " · not enough ratings to average"}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </TooltipProvider>
  );
}
