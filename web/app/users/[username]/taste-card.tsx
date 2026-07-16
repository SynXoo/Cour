"use client";

import type { CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { criticVerdict, scaleVerdict, type ScoreBias } from "@/lib/profile";

// The bar reads ±2 points off the crowd; past that the needle just pins.
const MAX_DELTA = 2;

/**
 * The stat a tracker veteran actually screenshots: am I harsh, or is everyone
 * else generous? A diverging needle against the community's mean over the very
 * same shows, plus how much of the 1-10 scale the owner bothers to use.
 */
export function TasteCard({
  bias,
  stddev,
  ratedCount,
}: {
  bias: ScoreBias | null;
  stddev: number | null;
  ratedCount: number;
}) {
  if (!bias && stddev == null) return null;

  return (
    <div className="grid gap-6 rounded-lg border border-border/60 bg-card p-5 sm:grid-cols-2">
      {bias && <CriticNeedle bias={bias} />}
      {stddev != null && <ScaleSpread stddev={stddev} ratedCount={ratedCount} />}
    </div>
  );
}

function CriticNeedle({ bias }: { bias: ScoreBias }) {
  const { label, delta } = criticVerdict(bias);
  const clamped = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta));
  // 0 delta sits dead center; the needle walks out from there either way.
  const offsetPercent = 50 + (clamped / MAX_DELTA) * 50;
  const signed = `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <h3 className="tint-ink text-sm font-semibold uppercase tracking-wide">Score bias</h3>
        <p className="text-2xl font-bold tracking-tight">{label}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {signed} vs the crowd, across {bias.sample_size} rated{" "}
          {bias.sample_size === 1 ? "show" : "shows"}
        </p>

        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="relative mt-3 h-2 w-full cursor-default rounded-full bg-muted"
              role="img"
              aria-label={`${label}: rates ${signed} against the community mean of ${bias.community_mean.toFixed(2)}`}
            >
              {/* The crowd's position, always the midpoint by construction. */}
              <span
                aria-hidden
                className="absolute inset-y-[-3px] left-1/2 w-px -translate-x-1/2 bg-border"
              />
              <span
                aria-hidden
                style={{ "--offset": `${offsetPercent}%` } as CSSProperties}
                className="needle tint-fill absolute inset-y-[-4px] left-[var(--offset)] w-1.5 -translate-x-1/2 rounded-full"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            You {bias.user_mean.toFixed(2)} · crowd {bias.community_mean.toFixed(2)}
          </TooltipContent>
        </Tooltip>

        <div className="flex justify-between font-mono text-[10px] text-muted-foreground" aria-hidden>
          <span>harsher</span>
          <span>the crowd</span>
          <span>kinder</span>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ScaleSpread({ stddev, ratedCount }: { stddev: number; ratedCount: number }) {
  // Bars stand for the 1-10 scale; the lit middle band is roughly ±1σ, so a
  // cautious rater lights three bars and an adventurous one lights nine.
  const lit = Math.max(1, Math.min(10, Math.round(stddev * 2)));
  const from = Math.max(0, Math.round((10 - lit) / 2));

  return (
    <div className="space-y-2">
      <h3 className="tint-ink text-sm font-semibold uppercase tracking-wide">Use of the scale</h3>
      <p className="text-2xl font-bold tracking-tight">{scaleVerdict(stddev)}</p>
      <p className="font-mono text-xs text-muted-foreground">
        σ {stddev.toFixed(2)} across {ratedCount} rated {ratedCount === 1 ? "show" : "shows"}
      </p>
      <div className="mt-3 flex h-2 gap-1" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            style={{ "--i": i } as CSSProperties}
            className={
              i >= from && i < from + lit
                ? "genre-fill tint-fill flex-1 rounded-full"
                : "flex-1 rounded-full bg-muted"
            }
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground" aria-hidden>
        <span>everything&apos;s a 7</span>
        <span>1 through 10</span>
      </div>
    </div>
  );
}
