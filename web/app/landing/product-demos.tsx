"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * The landing's product tour: three tiny self-running scenes that show what
 * Cour does — a live episode room filling up, the spoiler shield lifting as
 * your progress catches up, and tonight's line-up with notifications landing.
 * Pure UI theatre (no data, no network): the fixtures below are invented, so
 * the front door never quotes a real member (the live panel's rule, kept).
 * Every scene is a looping step counter; reduced motion freezes each on its
 * finished frame, and the loop idles while the tab is hidden.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void) {
  const mq = window.matchMedia?.(REDUCE);
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia?.(REDUCE).matches ?? false,
    () => false,
  );
}

function useStep(count: number, ms: number): number {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      setTick((s) => (s + 1) % count);
    }, ms);
    return () => clearInterval(timer);
  }, [count, ms, reduced]);
  return reduced ? count - 1 : tick;
}

/** Deterministic avatar hue per handle — the thread pages' identity trick. */
function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="avatar-hue flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold"
      style={{ "--avatar-hue": hue(name) } as React.CSSProperties}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/* ── Scene 1: the live room ─────────────────────────────────────────────── */

const ROOM_COMMENTS = [
  { user: "rin", at: "21:02", text: "that last cut was pure sakuga", reacts: "🔥 12" },
  { user: "sakuga_sam", at: "21:04", text: "the pacing this week 👌 no wasted frames" },
  { user: "noodle", at: "21:05", text: "ok the strings under the bridge scene??" },
  { user: "mika", at: "21:07", text: "12:41 — chills. every single time.", reacts: "💯 8" },
];

function RoomScene() {
  const step = useStep(6, 1700);
  const shown = Math.min(step + 1, ROOM_COMMENTS.length);
  const present = 11 + step * 2;

  return (
    <div className="relative flex h-full flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden
          className="flex h-11 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/70 to-primary/20 font-mono text-[10px] font-bold text-primary-foreground"
        >
          EP7
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Frieren: Beyond Journey&apos;s End</p>
          <p className="font-mono text-xs text-muted-foreground">Ep 7 room · airs Fridays</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-live/30 bg-live/10 px-2 py-0.5 font-mono text-[11px] text-live">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
          </span>
          <span data-testid="room-presence">{present} here</span>
        </span>
      </div>
      {/* Chat-style: newest at the bottom, the oldest clip off the top once
          the stage is full — the room never spills onto the caption. */}
      <ul
        className="flex flex-1 flex-col justify-end gap-1.5 overflow-hidden"
        data-testid="room-comments"
      >
        {ROOM_COMMENTS.slice(0, shown).map((c) => (
          <li key={c.user} className="comment-enter flex items-start gap-2">
            <Avatar name={c.user} />
            <div className="min-w-0 flex-1 rounded-lg rounded-tl-sm bg-muted/70 px-2.5 py-1.5">
              <p className="flex items-baseline gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">@{c.user}</span>
                <span>{c.at}</span>
              </p>
              <p className="text-sm leading-snug">{c.text}</p>
              {c.reacts && (
                <span className="mt-1 inline-block rounded-full border border-border/60 bg-background/60 px-1.5 py-px font-mono text-[10px]">
                  {c.reacts}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div
        className={cn(
          "absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-live px-2.5 py-0.5 font-mono text-[11px] font-semibold text-live-foreground shadow-lg transition-opacity duration-300",
          step >= 4 ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={step < 4}
      >
        2 new ↓
      </div>
    </div>
  );
}

/* ── Scene 2: the spoiler shield ────────────────────────────────────────── */

const SHIELD_EP = 9;
const TOTAL = 12;

function ShieldScene() {
  const step = useStep(6, 1600);
  // 7 → 8 → 9, then hold on the unblurred comment before looping.
  const ep = 7 + Math.min(step, 2);
  const open = ep >= SHIELD_EP;
  const pressing = step === 1 || step === 2;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Your progress</p>
          <p className="font-mono text-xs">
            <span className="font-semibold text-foreground" data-testid="shield-ep">
              Ep {ep}
            </span>{" "}
            / {TOTAL}
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${(ep / TOTAL) * 100}%` }}
            />
          </div>
          {/* Keyed by step so each "press" remounts and replays its dip. */}
          <span
            key={step}
            aria-hidden
            className={cn(
              "rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary",
              pressing && "demo-press",
            )}
          >
            +1
          </span>
        </div>
      </div>

      <div className="relative flex-1 rounded-lg border border-border/60 bg-muted/40 p-2.5">
        <p className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <Avatar name="noodle" />
          <span className="font-medium text-foreground">@noodle</span>
          <span>Ep {SHIELD_EP} room</span>
        </p>
        <p
          data-testid="shield-body"
          data-open={open}
          className={cn(
            "mt-1.5 select-none text-sm leading-snug transition-[filter,opacity] duration-500",
            open ? "blur-0 opacity-100" : "blur-[6px] opacity-60",
          )}
        >
          That reveal recontextualizes the whole first arc — I need to rewatch
          episode two tonight.
        </p>
        <div
          aria-hidden={open}
          className={cn(
            "absolute inset-x-2.5 bottom-2.5 flex items-center gap-2 rounded-md border border-lilac/40 bg-background/90 px-2.5 py-1.5 text-xs backdrop-blur-sm transition-opacity duration-300",
            open ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <span aria-hidden className="text-lilac">
            ◐
          </span>
          <span className="text-muted-foreground">
            Spoiler shield · you&apos;re on Ep {ep}, this is Ep {SHIELD_EP}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Scene 3: tonight + notifications ───────────────────────────────────── */

const EVENING = [
  { title: "Dandadan", meta: "Ep 8", when: "in 42m", live: true },
  { title: "Jujutsu Kaisen", meta: "Ep 3", when: "in 2h 15m" },
];

const TOASTS = [
  { icon: "🔔", text: "Dandadan Ep 8 airs in 20 min" },
  { icon: "💬", text: "@rin replied to your comment" },
  { icon: "📈", text: "Your Ep 7 thread is heating up · 31 new" },
];

function TonightScene() {
  const step = useStep(6, 1500);
  // Toasts land one per step from step 1; the last frame clears the stack.
  const shown = step === 5 ? 0 : Math.min(step, TOASTS.length);

  return (
    <div className="relative flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold tracking-tight">
          Your <span className="text-primary">evening</span>
        </p>
        <span className="relative rounded-md p-1 text-muted-foreground" aria-hidden>
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {shown > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-live px-1 font-mono text-[10px] font-bold text-live-foreground">
              {shown}
            </span>
          )}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {EVENING.map((e) => (
          <li
            key={e.title}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2",
              e.live && "border-gold/40",
            )}
          >
            <span
              aria-hidden
              className="h-9 w-6 shrink-0 rounded bg-gradient-to-b from-muted-foreground/40 to-muted"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e.title}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{e.meta}</p>
            </div>
            <span
              className={cn(
                "font-mono text-xs",
                e.live ? "text-gold" : "text-muted-foreground",
              )}
            >
              {e.when}
            </span>
          </li>
        ))}
      </ul>
      {/* The notification tray fills the rest of the stage, newest at the
          bottom — its own space, never over the list. */}
      <ul
        className="pointer-events-none flex flex-1 flex-col justify-end gap-1.5"
        data-testid="toasts"
        aria-live="off"
      >
        {TOASTS.slice(0, shown).map((t) => (
          <li
            key={t.text}
            className="room-enter flex items-center gap-2 rounded-lg border border-border/60 bg-popover/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur"
          >
            <span aria-hidden>{t.icon}</span>
            <span className="truncate">{t.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── The tour ───────────────────────────────────────────────────────────── */

const SCENES = [
  {
    id: "rooms",
    eyebrow: "Live rooms",
    accent: "text-live",
    title: "Every episode gets a room",
    body: "The moment an episode airs, its thread is open — with the people watching it right now, not a week later.",
    Scene: RoomScene,
  },
  {
    id: "shield",
    eyebrow: "Spoiler shield",
    accent: "text-lilac",
    title: "Spoilers wait for you",
    body: "Comments from episodes past your progress stay blurred. Hit +1 as you watch and the room opens up with you.",
    Scene: ShieldScene,
  },
  {
    id: "tonight",
    eyebrow: "Tonight",
    accent: "text-gold",
    title: "Know what's on tonight",
    body: "Your list becomes an evening: countdowns for your shows, a nudge when one airs, a ping when someone replies.",
    Scene: TonightScene,
  },
] as const;

export function ProductDemos() {
  return (
    <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {SCENES.map(({ id, eyebrow, accent, title, body, Scene }) => (
        <li
          key={id}
          className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 md:last:max-lg:col-span-2"
        >
          <div className="tour-stage h-[18rem] overflow-hidden border-b border-border/60 p-4">
            <Scene />
          </div>
          <div className="space-y-1.5 p-5">
            <p className={cn("font-mono text-xs", accent)}>{eyebrow}</p>
            <h3 className="text-base font-semibold tracking-tight">{title}</h3>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
