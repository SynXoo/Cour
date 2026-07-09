"use client";

import type { CSSProperties } from "react";
import { commentDensity } from "@/lib/thread-texture";
import { formatTimestamp } from "@/lib/timestamp";
import { cn } from "@/lib/utils";
import { jumpToComment, type Comment } from "./comment-item";

/**
 * The timestamp-density strip (M3.4): the episode's discussion drawn as a
 * waveform. Bars show where the `12:34`-anchored comments concentrate; each
 * cluster (a run of adjacent busy buckets) is a real button spanning its
 * region — thin bars can't be touch targets, cluster regions can — that jumps
 * the list to its earliest comment. Hidden when nothing is timestamped.
 */
export function TimestampDensity({ comments }: { comments: Comment[] }) {
  const density = commentDensity(comments);
  if (!density) return null;
  const { bars, maxCount, axisEnd, total, clusters } = density;

  return (
    <section
      aria-label="Where the discussion lands in the episode"
      className="rounded-lg border border-border/60 bg-card/50 p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Episode timeline
        </p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {total} anchored comment{total === 1 ? "" : "s"}
        </p>
      </div>

      <div className="relative mt-2">
        {/* The waveform is decoration; the cluster buttons on top carry the
            semantics and the hit areas. */}
        <div aria-hidden className="flex h-12 items-end gap-px">
          {bars.map((count, i) => (
            <span
              key={i}
              className={cn(
                "flex-1 rounded-t-[2px] transition-all duration-300 motion-reduce:transition-none",
                count > 0 ? "density-bar bg-primary" : "bg-border/60",
              )}
              style={
                count > 0
                  ? ({
                      height: `${18 + 82 * (count / maxCount)}%`,
                      opacity: 0.45 + 0.55 * (count / maxCount),
                      "--i": i,
                    } as CSSProperties)
                  : { height: "3px" }
              }
            />
          ))}
        </div>
        {clusters.map((cl) => {
          const label = `${cl.count} comment${cl.count === 1 ? "" : "s"} around ${formatTimestamp(cl.peakSeconds)}`;
          return (
            <button
              key={cl.firstId}
              type="button"
              onClick={() => jumpToComment(cl.firstId)}
              title={label}
              aria-label={`Jump to ${label}`}
              className="absolute inset-y-0 rounded transition-colors hover:bg-primary/15 focus-visible:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60"
              style={{
                left: `${cl.startPct}%`,
                // Never thinner than a fingertip, even for a one-bucket blip.
                width: `max(${cl.widthPct}%, 1.75rem)`,
              }}
            />
          );
        })}
      </div>

      <div aria-hidden className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>0:00</span>
        <span>{formatTimestamp(axisEnd)}</span>
      </div>
    </section>
  );
}
