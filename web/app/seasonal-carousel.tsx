import { AnimeCard } from "@/components/anime/anime-card";
import type { AnimeSummary } from "@/lib/api/client";

/**
 * The seasonal chart as one browsable rail: a single row of bigger art that
 * scrolls (and snaps) sideways. It used to be a looping marquee of four
 * copies — the hero already carries the motion, and a landing that shows the
 * same fourteen posters four times over reads as wallpaper, not a chart.
 * Every card here is real content: one copy, all of them links.
 */
export function SeasonalCarousel({ anime }: { anime: AnimeSummary[] }) {
  const items = anime.filter((a) => a.cover_image);
  if (items.length === 0) return null;

  return (
    // -mx-4/px-4: the rail bleeds to the viewport edge so a half-visible card
    // hints there's more, while the first card still aligns with the heading.
    <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]">
      <ul className="flex w-max snap-x snap-mandatory gap-4 pr-4">
        {items.map((a) => (
          <li key={a.id} className="w-36 shrink-0 snap-start md:w-44">
            <AnimeCard anime={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}
