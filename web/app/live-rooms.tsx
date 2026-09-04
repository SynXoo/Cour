"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LiveRoom } from "@/lib/landing";

const VISIBLE = 4;
const ROTATE_MS = 5000;

/**
 * The hero's live panel: a slow rotation through the busiest rooms. Every
 * ROTATE_MS the window advances one row; the entering room plays a gentle
 * spring slide (`room-enter`) so arrivals read like messages landing, not a
 * carousel snapping. Rotation stops under prefers-reduced-motion, while the
 * pointer is over the list, or when everything already fits. Deliberately
 * no comment bodies here — rooms and their activity, never a quote.
 */
export function LiveRooms({ rooms }: { rooms: LiveRoom[] }) {
  const [head, setHead] = useState(0);
  const [paused, setPaused] = useState(false);
  const rotates = rooms.length > VISIBLE;

  useEffect(() => {
    if (!rotates || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setHead((h) => (h + 1) % rooms.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotates, paused, rooms.length]);

  const visible = Array.from(
    { length: Math.min(VISIBLE, rooms.length) },
    (_, i) => rooms[(head + i) % rooms.length],
  );

  return (
    // The 4th slot only appears from lg — the stacked mobile hero stays lean.
    <ul
      className="flex flex-col gap-2 max-lg:[&>li:nth-child(n+4)]:hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {visible.map((room) => (
        // Keyed by thread id: surviving rows shift without remounting, so
        // only the room entering the window animates.
        <li key={room.threadId} className="room-enter">
          <Link
            href={room.href}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/50"
          >
            <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-muted">
              {room.cover && (
                <Image src={room.cover} alt="" fill sizes="40px" className="object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{room.title}</p>
              <p className="mt-0.5 flex items-baseline gap-x-2 font-mono text-xs text-muted-foreground">
                <span className="truncate">
                  {room.label} · {room.commentCount} comment
                  {room.commentCount === 1 ? "" : "s"}
                  {room.presence > 0 && (
                    <span className="text-live"> · {room.presence} in there</span>
                  )}
                </span>
                <time className="ml-auto shrink-0">{room.ago}</time>
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
