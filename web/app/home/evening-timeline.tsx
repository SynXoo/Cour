"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { browserApi } from "@/lib/api/client";
import type { ScheduleEntry } from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";
import {
  timelineMarks,
  timelineNowPct,
  timelineTicks,
  type TimelineMark,
} from "@/lib/home";
import { cn } from "@/lib/utils";
import { Countdown } from "./countdown";

type RoomStats = Record<string, { presence: number; comments: number }>;

const LANE_RISE_PX = 18;

/**
 * Tonight as a physical object: a 25-hour axis (one hour of just-aired grace,
 * then the next 24) with a half-hour grid, a breathing "now" line, and your
 * episodes pinned as cover thumbnails at their exact air times — collisions
 * stack into lanes. Hover or focus a cover and a preview card opens (the
 * synopsis lazy-loads from the detail endpoint on first look); click drops
 * you into the episode thread. Desktop-only by design — under `lg` the rail
 * cards carry the same information in a touch-friendly form.
 */
export function EveningTimeline({
  entries,
  rooms,
}: {
  entries: ScheduleEntry[];
  rooms: RoomStats;
}) {
  // Re-anchor each minute so a long-open tab keeps "now" honest; positions
  // drift imperceptibly (1/1500 per minute) but the label math stays true.
  const [anchor, setAnchor] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setAnchor(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const marks = useMemo(() => timelineMarks(entries, anchor), [entries, anchor]);
  const ticks = useMemo(() => timelineTicks(anchor), [anchor]);
  const [active, setActive] = useState<string | null>(null);

  if (marks.length === 0) return null;

  const nowPct = timelineNowPct();
  const activeMark = marks.find((m) => markKey(m.entry) === active) ?? null;

  return (
    <div
      role="group"
      aria-label="Tonight on your timeline"
      className="relative hidden rounded-xl border border-border/60 bg-card/40 px-4 pb-2 pt-4 lg:block"
    >
      {activeMark && <MarkPreview mark={activeMark} rooms={rooms} />}

      <div className="relative h-32">
        {/* Axis + half-hour grid. */}
        <div aria-hidden className="absolute inset-x-0 bottom-9 h-px bg-border" />
        {ticks.map((t) => (
          <div key={t.time.getTime()} aria-hidden>
            <div
              className={cn(
                "absolute bottom-9 w-px -translate-x-1/2 bg-border",
                t.isHour ? "h-2.5" : "h-1.5 opacity-60",
              )}
              style={{ left: `${t.pct}%` }}
            />
            {tickLabel(t) && (
              <span
                className={cn(
                  "absolute bottom-2 -translate-x-1/2 font-mono text-[10px]",
                  t.isMidnight ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
                style={{ left: `${t.pct}%` }}
              >
                {tickLabel(t)}
              </span>
            )}
          </div>
        ))}

        {/* The now line. */}
        <div aria-hidden style={{ left: `${nowPct}%` }} className="absolute bottom-9 top-1">
          <div className="absolute inset-y-0 w-px -translate-x-1/2 bg-primary/50" />
          <span className="absolute top-0 flex h-2 w-2 -translate-x-1/2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
        </div>
        <span
          style={{ left: `${nowPct}%` }}
          className="absolute bottom-2 -translate-x-1/2 font-mono text-[10px] font-semibold text-primary"
        >
          now
        </span>

        {/* The episodes. */}
        <ul aria-label="Your episodes tonight">
          {marks.map((m) => {
            const key = markKey(m.entry);
            const a = m.entry.anime;
            return (
              <li
                key={key}
                className="absolute -translate-x-1/2"
                style={{
                  left: `${m.pct}%`,
                  bottom: `${44 + m.lane * LANE_RISE_PX}px`,
                }}
                onMouseEnter={() => setActive(key)}
                onMouseLeave={() => setActive((cur) => (cur === key ? null : cur))}
              >
                {/* Stem: ties the cover to its exact minute on the axis. */}
                <div
                  aria-hidden
                  className="absolute left-1/2 top-full w-px -translate-x-1/2 bg-border"
                  style={{ height: `${8 + m.lane * LANE_RISE_PX}px` }}
                />
                <Link
                  href={`/anime/${a.id}/episode/${m.entry.episode}`}
                  aria-label={`${displayTitle(a)} — Ep ${m.entry.episode}, ${timeLabel(m.entry.airing_at)}`}
                  aria-describedby={active === key ? "timeline-preview" : undefined}
                  onFocus={() => setActive(key)}
                  onBlur={() => setActive((cur) => (cur === key ? null : cur))}
                  onKeyDown={(e) => e.key === "Escape" && setActive(null)}
                  className={cn(
                    "relative block h-14 w-10 overflow-hidden rounded-md border bg-muted shadow-sm transition-transform",
                    active === key
                      ? "z-10 scale-110 border-primary"
                      : "border-border/60 hover:scale-105",
                  )}
                >
                  {a.cover_image && (
                    <Image src={a.cover_image} alt="" fill sizes="40px" className="object-cover" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const markKey = (e: ScheduleEntry) => `${e.anime.id}-${e.episode}`;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function tickLabel(t: { time: Date; isHour: boolean; isMidnight: boolean }): string | null {
  if (t.isMidnight) {
    return t.time.toLocaleDateString([], { weekday: "short" });
  }
  if (t.isHour && t.time.getHours() % 3 === 0) {
    return t.time.toLocaleTimeString([], { hour: "numeric" });
  }
  return null;
}

/** The hover/focus card: art, airing facts, room pulse, lazy synopsis. */
function MarkPreview({ mark, rooms }: { mark: TimelineMark; rooms: RoomStats }) {
  const a = mark.entry.anime;
  const room = rooms[`${a.id}:${mark.entry.episode}`];

  // The synopsis rides AnimeDetail, not the schedule payload — fetch it the
  // first time a show is looked at, then it's cached for the session.
  const { data: detail } = useQuery({
    queryKey: ["anime-preview", a.id],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await browserApi.GET("/anime/{id}", { params: { path: { id: a.id } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  // Clamp so the card never bleeds past the panel's edges.
  const left = Math.min(84, Math.max(16, mark.pct));

  return (
    <div
      id="timeline-preview"
      role="tooltip"
      style={{ left: `${left}%` }}
      className="room-enter absolute bottom-full z-20 mb-2 w-80 -translate-x-1/2 rounded-xl border border-border/60 bg-popover p-3 shadow-lg"
    >
      <div className="flex gap-3">
        <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
          {a.cover_image && (
            <Image src={a.cover_image} alt="" fill sizes="64px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="line-clamp-1 text-sm font-semibold">{displayTitle(a)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            Ep {mark.entry.episode} · {timeLabel(mark.entry.airing_at)} ·{" "}
            <Countdown iso={mark.entry.airing_at} className="text-primary" />
          </p>
          {a.genres.length > 0 && (
            <p className="line-clamp-1 font-mono text-xs text-muted-foreground/80">
              {a.genres.slice(0, 3).join(" · ")}
            </p>
          )}
          {room && room.presence > 0 && (
            <p className="font-mono text-xs text-primary">
              {room.presence} in the room already
            </p>
          )}
        </div>
      </div>
      {detail?.description && (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {detail.description}
        </p>
      )}
    </div>
  );
}
