"use client";

import type { CSSProperties } from "react";

/**
 * The genre breakdown, kept from the old profile but tinted and clickable:
 * each bar filters the library below to that genre. Fills sweep in once on
 * mount (`.genre-fill`, off under reduced motion).
 */
export function GenreBars({
  genres,
  onPick,
}: {
  genres: { genre: string; count: number }[];
  onPick: (genre: string) => void;
}) {
  const max = Math.max(1, ...genres.map((g) => g.count));

  return (
    <ul className="flex flex-col gap-0.5">
      {genres.map((g, i) => (
        <li key={g.genre}>
          <button
            type="button"
            onClick={() => onPick(g.genre)}
            className="group flex h-11 w-full items-center gap-2 rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7"
            aria-label={`${g.count} ${g.genre} shows — see them below`}
          >
            <span className="w-28 shrink-0 truncate text-left text-muted-foreground group-hover:text-foreground">
              {g.genre}
            </span>
            <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                style={{ width: `${Math.max(4, (g.count / max) * 100)}%`, "--i": i } as CSSProperties}
                className="genre-fill tint-fill absolute inset-y-0 left-0 rounded-full transition-opacity group-hover:opacity-80"
              />
            </span>
            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {g.count}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
