"use client";

import type { CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The 1–10 rating shape as clickable bars: hover tells you count + share,
 * click filters the library below to exactly that score. Bars rise once on
 * mount (`.stat-bar`, off under reduced motion).
 */
export function ScoreHistogram({
  histogram,
  ratedCount,
  username,
  onPick,
}: {
  histogram: { score: number; count: number }[];
  ratedCount: number;
  username: string;
  onPick: (score: number) => void;
}) {
  const peak = Math.max(...histogram.map((b) => b.count), 0);

  if (ratedCount === 0 || peak === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No ratings yet — the shape of @{username}&apos;s taste shows up here once shows get scored.
      </p>
    );
  }

  return (
    <TooltipProvider>
      <div role="group" aria-label="Score distribution, 1 to 10">
        <div className="flex h-28 items-end gap-1">
          {histogram.map((b, i) => {
            const share = Math.round((b.count / ratedCount) * 100);
            return (
              <Tooltip key={b.score}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onPick(b.score)}
                    aria-label={`${b.count} rated ${b.score} — see them below`}
                    className="group flex h-full flex-1 flex-col justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      style={{ height: `${Math.max((b.count / peak) * 100, 2)}%`, "--i": i } as CSSProperties}
                      className={
                        b.count > 0
                          ? "stat-bar tint-fill block w-full rounded-t-sm transition-opacity group-hover:opacity-80"
                          : "block w-full rounded-t-sm bg-muted"
                      }
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {b.count === 0
                    ? `Nothing rated ${b.score}`
                    : `${b.count} rated ${b.score} · ${share}% — click to browse`}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1" aria-hidden>
          {histogram.map((b) => (
            <span key={b.score} className="flex-1 text-center font-mono text-[10px] text-muted-foreground">
              {b.score}
            </span>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
