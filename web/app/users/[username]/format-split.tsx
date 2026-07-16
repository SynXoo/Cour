"use client";

import type { CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatLabel } from "@/lib/anime";
import type { Format, FormatCount } from "@/lib/profile";

// Anything thinner than this disappears into its own borders; give the long
// tail a floor and let the wide segments absorb the rounding.
const MIN_SEGMENT_PERCENT = 4;

/**
 * TV or theatre? One stacked bar of the library by format, each segment a
 * click into that format below. Opacity, not hue, separates the segments —
 * the accent is the owner's, and a rainbow here would fight it.
 */
export function FormatSplit({
  formats,
  onPick,
}: {
  formats: FormatCount[];
  onPick: (format: Format) => void;
}) {
  const total = formats.reduce((sum, f) => sum + f.count, 0);
  if (total === 0) return null;

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <h3 className="tint-ink text-sm font-semibold uppercase tracking-wide">Formats</h3>

        <div className="flex h-8 gap-1 overflow-hidden" role="group" aria-label="Library by format">
          {formats.map((f, i) => {
            const share = Math.round((f.count / total) * 100);
            const label = formatLabel(f.format) ?? f.format;
            return (
              <Tooltip key={f.format}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onPick(f.format)}
                    aria-label={`${f.count} ${label} — ${share}% of the library, see them below`}
                    style={{
                      flexGrow: Math.max(f.count / total, MIN_SEGMENT_PERCENT / 100),
                      opacity: 1 - i * 0.16,
                      "--i": i,
                    } as CSSProperties}
                    className="genre-fill tint-fill min-w-0 rounded-sm outline-none transition-transform hover:scale-y-110 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {f.count} {label} · {share}% — click to browse
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {formats.map((f, i) => (
            <li key={f.format} className="flex items-center gap-1.5">
              <span
                aria-hidden
                style={{ opacity: 1 - i * 0.16 }}
                className="tint-fill size-2 shrink-0 rounded-full"
              />
              <span className="text-xs text-muted-foreground">
                {formatLabel(f.format) ?? f.format}{" "}
                <span className="font-mono tabular-nums">{f.count}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </TooltipProvider>
  );
}
