"use client";

import Link from "next/link";
import { usePartyPulse } from "@/lib/hooks/use-parties";
import { cn } from "@/lib/utils";

/**
 * The header's Parties link. It carries a live count because that is the
 * whole argument for the slot: a nav entry that looks identical on a dead
 * night and a busy one teaches nobody that the feature is alive. Shares the
 * discovery query with the home rail and the hub, so the badge costs no
 * extra request; renders as a plain link while the flag is off or nothing
 * is open.
 */
export function PartiesNavLink({ className }: { className?: string }) {
  const pulse = usePartyPulse();

  return (
    <Link
      href="/parties"
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        pulse && "text-foreground",
        className,
      )}
    >
      Parties
      {pulse && (
        <span
          className="inline-flex items-center gap-1 font-mono text-xs text-live"
          aria-label={`${pulse.rooms} ${pulse.rooms === 1 ? "party" : "parties"} open, ${pulse.watching} watching`}
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
          </span>
          <span aria-hidden>{pulse.rooms}</span>
        </span>
      )}
    </Link>
  );
}

/**
 * The same signal as a bare dot, for the mobile tab bar where a number would
 * not fit. Purely visual — it sits over the tab icon, ahead of the label, so
 * labelling it here would read the count out before the destination's name;
 * `PartiesLiveCount` carries that for screen readers, after the label.
 * Null when nothing is open, so the tab looks ordinary on a quiet night.
 */
export function PartiesLiveDot({ className }: { className?: string }) {
  const pulse = usePartyPulse();
  if (!pulse) return null;
  return (
    <span className={cn("relative flex h-1.5 w-1.5", className)} aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
    </span>
  );
}

/** The dot's meaning in words, for the tab's accessible name. */
export function PartiesLiveCount() {
  const pulse = usePartyPulse();
  if (!pulse) return null;
  return <span className="sr-only">, {pulse.rooms} open now</span>;
}
