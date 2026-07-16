"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const DURATION_MS = 900;
// Fast out of the gate, long settle — the number lands rather than stops.
const easeOut = (t: number) => 1 - (1 - t) ** 3;

// useLayoutEffect warns during SSR; the zeroing below has to beat first paint
// on the client, so switch rather than accept a flash of the final value.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A statistic that counts up the first time it scrolls into view.
 *
 * React renders the *true* value, and the animation mutates textContent
 * imperatively from a layout effect: server HTML, no-JS, and reduced-motion
 * readers all get the real number with no hydration mismatch, and a re-render
 * mid-flight can only ever restore the truth.
 */
export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  /** Kept in a ref, so an inline arrow can't restart the animation. */
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Both live in refs, so neither an inline `format` arrow nor a changing
  // target can retrigger the animation. It runs once per mount; a value that
  // moves mid-flight is simply the new destination, and one that moves after
  // it lands is just React rendering the truth over a finished animation.
  const formatRef = useRef(format);
  const valueRef = useRef(value);

  // Refreshed after every commit — writing refs during render is unsafe once
  // rendering can be interrupted, and this lands well before the next frame.
  useIsomorphicLayoutEffect(() => {
    formatRef.current = format;
    valueRef.current = value;
  });

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.textContent = formatRef.current(0);

    let raf = 0;
    let startedAt = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const step = (now: number) => {
          startedAt ||= now;
          const progress = Math.min((now - startedAt) / DURATION_MS, 1);
          el.textContent = formatRef.current(valueRef.current * easeOut(progress));
          if (progress < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
