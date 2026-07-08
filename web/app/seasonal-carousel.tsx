import { AnimeCard } from "@/components/anime/anime-card";
import type { AnimeSummary } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// Loop copies: two identical halves of two repetitions each (see the
// hero wall for the -50% seam math — ~12 cards × 2 reps ≈ 4200px a half).
const COPIES = 4;

/**
 * The seasonal chart as a slow-drifting rail instead of a static grid: one
 * row, bigger art, and the motion the hero starts carries down the page.
 * Unlike the poster wall this one is real content — cards are links — so
 * hover/focus pauses the drift (CSS), only the first copy is interactive
 * (the rest are `inert` loop filler), and reduced motion turns the whole
 * thing into an ordinary scrollable strip with the filler hidden.
 */
export function SeasonalCarousel({ anime }: { anime: AnimeSummary[] }) {
  const items = anime.filter((a) => a.cover_image);
  if (items.length === 0) return null;

  return (
    <div className="overflow-hidden motion-reduce:overflow-x-auto">
      <div
        className="landing-marquee flex w-max"
        style={{ "--marquee-duration": "180s" } as React.CSSProperties}
      >
        {Array.from({ length: COPIES }, (_, copy) => (
          <ul
            key={copy}
            aria-hidden={copy > 0 || undefined}
            inert={copy > 0 || undefined}
            className={cn("flex gap-4 pr-4", copy > 0 && "motion-reduce:hidden")}
          >
            {items.map((a) => (
              <li key={a.id} className="w-40 shrink-0 md:w-48">
                <AnimeCard anime={a} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
