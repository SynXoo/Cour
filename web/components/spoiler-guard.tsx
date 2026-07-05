"use client";

import { useState } from "react";

/**
 * Blurs spoiler content until the reader opts in. Used by reviews and
 * discussion comments. Keyboard accessible: the reveal control is a real
 * button overlaying the blurred content.
 */
export function SpoilerGuard({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);

  if (!active || revealed) {
    return <>{children}</>;
  }

  return (
    <div className="relative overflow-hidden rounded-md" data-testid="spoiler-guard">
      <div aria-hidden className="pointer-events-none select-none blur-md">
        {children}
      </div>
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="absolute inset-0 flex items-center justify-center bg-background/30 text-sm font-medium outline-none transition-colors hover:bg-background/20 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="rounded-full border border-border bg-background px-3 py-1.5 shadow-sm">
          ⚠ Spoilers — click to reveal
        </span>
      </button>
    </div>
  );
}
