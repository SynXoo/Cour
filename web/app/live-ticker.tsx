"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { hueFor } from "@/components/discussions/comment-item";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { TickerItem } from "@/lib/landing";

const VISIBLE = 3;
const ROTATE_MS = 4000;

/**
 * The landing page's live proof: a slow auto-scroll through the newest public
 * comments. Every ROTATE_MS the window advances one row; the entering row
 * plays the same slide-in the thread pages use for live arrivals. Rotation
 * stops under prefers-reduced-motion, while the pointer is over the list, or
 * when there's nothing beyond the window.
 */
export function LiveTicker({ items }: { items: TickerItem[] }) {
  const [head, setHead] = useState(0);
  const [paused, setPaused] = useState(false);
  const rotates = items.length > VISIBLE;

  useEffect(() => {
    if (!rotates || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setHead((h) => (h + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotates, paused, items.length]);

  const visible = Array.from(
    { length: Math.min(VISIBLE, items.length) },
    (_, i) => items[(head + i) % items.length],
  );

  return (
    <ul
      className="flex flex-col gap-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {visible.map((item) => (
        // Keyed by comment id: surviving rows shift without remounting, so
        // only the row entering the window animates.
        <li key={item.id} className="comment-enter">
          <Link
            href={item.href}
            className="flex min-h-[4.5rem] items-start gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/50"
          >
            <Avatar className="mt-0.5 h-6 w-6 text-[10px]">
              {item.avatarUrl && <AvatarImage src={item.avatarUrl} alt="" />}
              <AvatarFallback
                className="avatar-hue"
                style={{ "--avatar-hue": hueFor(item.username) } as CSSProperties}
              >
                {item.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="shrink-0 font-medium text-foreground">{item.username}</span>
                <span className="truncate">
                  on {item.animeTitle}
                  {item.episode != null && ` · Ep ${item.episode}`}
                </span>
                <time className="ml-auto shrink-0 font-mono">{item.ago}</time>
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm">{item.body}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
