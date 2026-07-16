"use client";

import type { CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fillEraGaps, peakEra, type SeasonCount } from "@/lib/profile";

/**
 * The shape of a watching life: completed shows by the year they premiered.
 * The axis is continuous (`fillEraGaps`) so a decade nobody touched reads as a
 * decade, not as two neighbouring bars. Clicking a year browses it below.
 */
export function EraStrip({
  seasons,
  onPick,
}: {
  seasons: SeasonCount[];
  onPick: (year: number) => void;
}) {
  const years = fillEraGaps(seasons);
  if (years.length === 0) return null;

  const peak = Math.max(...years.map((y) => y.count));
  const era = peakEra(years);
  // A wall of year labels is unreadable past a decade or so; thin them out but
  // always keep the ends, which are the ones that carry the span.
  const labelEvery = Math.ceil(years.length / 8);

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="tint-ink text-sm font-semibold uppercase tracking-wide">Eras</h3>
          {era !== null && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              your <span className="tint-ink font-semibold">{era}</span> era
            </p>
          )}
        </div>

        <div role="group" aria-label="Completed shows by premiere year">
          <div className="flex h-24 items-end gap-px">
            {years.map((y, i) => (
              <Tooltip key={y.year}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={y.count === 0}
                    onClick={() => onPick(y.year)}
                    aria-label={`${y.count} completed from ${y.year}${y.count > 0 ? " — see them below" : ""}`}
                    className="group flex h-full flex-1 flex-col justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  >
                    <span
                      style={{
                        height: `${Math.max((y.count / peak) * 100, 2)}%`,
                        "--i": i,
                      } as CSSProperties}
                      className={
                        y.count > 0
                          ? "era-bar tint-fill block w-full rounded-t-sm transition-opacity group-hover:opacity-80"
                          : "block w-full rounded-t-sm bg-muted"
                      }
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {y.count === 0
                    ? `Nothing from ${y.year}`
                    : `${y.count} from ${y.year} — click to browse`}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="mt-1 flex gap-px" aria-hidden>
            {years.map((y, i) => (
              <span
                key={y.year}
                className="flex-1 text-center font-mono text-[10px] text-muted-foreground"
              >
                {i % labelEvery === 0 || i === years.length - 1 ? `'${String(y.year).slice(2)}` : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
