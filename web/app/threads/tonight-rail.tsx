"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Countdown } from "@/app/home/countdown";
import type { TonightRoom } from "@/lib/threads-hub";

/**
 * "Opening tonight" — every show airing in the next 24 h as a room card with a
 * live countdown. A just-aired episode (its air time already past) flips to a
 * pulsing LIVE badge: the room is open now. The countdown ticks client-side,
 * which is the only reason this is an island; the data is server-computed.
 */
export function TonightRail({ rooms }: { rooms: TonightRoom[] }) {
  // Frozen at mount via a lazy state initializer (the purity-safe spot for
  // clock reads): Countdown owns the ticking; this only decides LIVE vs. not.
  const [nowMs] = useState(() => Date.now());

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rooms.map((room) => {
        const aired = new Date(room.airingAt).getTime() <= nowMs;
        return (
          <li key={`${room.animeId}:${room.episode}`}>
            <Link
              href={room.href}
              className="tint-card flex h-full items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50"
              style={room.coverColor ? ({ "--tint": room.coverColor } as React.CSSProperties) : undefined}
            >
              <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">
                {room.cover && (
                  <Image src={room.cover} alt="" fill sizes="44px" className="object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{room.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs">
                  {aired ? (
                    <span className="inline-flex items-center gap-1 text-live">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
                      </span>
                      LIVE
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">
                    Ep {room.episode} · <Countdown iso={room.airingAt} className="text-gold" />
                  </span>
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {room.presence > 0 || room.comments > 0 ? (
                    <>
                      {room.presence > 0 && (
                        <span className="text-live">{room.presence} in there · </span>
                      )}
                      {room.comments} comment{room.comments === 1 ? "" : "s"}
                    </>
                  ) : (
                    "The room's still quiet"
                  )}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
