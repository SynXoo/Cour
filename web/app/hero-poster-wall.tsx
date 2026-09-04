import Image from "next/image";
import type { AnimeSummary } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const MIN_COVERS = 8;

// Each marquee half repeats its row this many times. The -50% translate
// loops seamlessly only while one half is wider than the viewport; a row of
// ~13 posters is ~2000px on desktop, so ×2 clears even a 2560px screen —
// without this, long dwellers watch the tail drift past into blank space.
// (Was ×3 over a 9-poster row: the same cover came round three times per
// screen, which read as wallpaper. More distinct covers, fewer repeats.)
const REPS = 2;

/**
 * The landing hero's backdrop: popular covers drifting in two slow
 * counter-moving rows behind the copy. Purely decorative — hidden from the
 * accessibility tree, no links, no pointer events. The wall dissolves at its
 * edges via `hero-wall-mask`, letting the landing's ambient tint show
 * through instead of painting a color that must match. Readability over the
 * copy is the copy's own job (its backdrop plate in landing-view.tsx), so
 * the wall never needs to know where the text sits.
 */
export function HeroPosterWall({ anime }: { anime: AnimeSummary[] }) {
  const covers = anime.filter((a) => a.cover_image);
  if (covers.length < MIN_COVERS) return null;

  const rows = [
    covers.filter((_, i) => i % 2 === 0),
    covers.filter((_, i) => i % 2 === 1),
  ];

  return (
    <div
      aria-hidden
      className="hero-wall-mask pointer-events-none absolute inset-0 select-none overflow-hidden"
    >
      {/* Slight tilt + overscale so the rotated wall still covers the
          corners; opacity dims the art well toward the ambient behind it —
          the wall is a backdrop for the copy, not a poster grid. */}
      <div className="absolute inset-0 flex rotate-[-4deg] scale-110 flex-col justify-center gap-3 opacity-55 md:gap-4">
        {rows.map((row, r) => (
          <div
            key={r}
            className={cn("landing-marquee flex w-max", r === 1 && "landing-marquee-reverse")}
            style={{ "--marquee-duration": r === 0 ? "200s" : "260s" } as React.CSSProperties}
          >
            {/* Two identical halves for the loop, each REPS rows wide. */}
            {[0, 1].map((half) => (
              <ul key={half} className="flex gap-3 pr-3 md:gap-4 md:pr-4">
                {Array.from({ length: REPS }, (_, rep) =>
                  row.map((a) => (
                    <li
                      key={`${rep}-${a.id}`}
                      className="relative h-32 w-[5.5rem] shrink-0 overflow-hidden rounded-md bg-muted md:h-[13.5rem] md:w-36"
                    >
                      <Image
                        src={a.cover_image!}
                        alt=""
                        fill
                        sizes="(min-width: 768px) 144px, 88px"
                        className="object-cover"
                      />
                    </li>
                  )),
                )}
              </ul>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
