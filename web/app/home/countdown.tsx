"use client";

import { useEffect, useState } from "react";
import { untilLabel } from "@/lib/anime";

/**
 * A live "in 1h 24m" label that re-renders every 30 s — coarse enough to be
 * cheap across a row of cards, fine enough that the number visibly moves
 * while you linger. Once airing time passes it settles on "airing now"
 * (the tonight window keeps a card around for an hour after air).
 * This is information, not decoration, so it keeps ticking under
 * prefers-reduced-motion — it just never animates.
 */
export function Countdown({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time dateTime={iso} className={className}>
      {untilLabel(iso, now)}
    </time>
  );
}
