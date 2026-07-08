import Image from "next/image";
import type { AnimeSummary } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const MIN_COVERS = 8;

/**
 * The landing hero's backdrop: popular covers drifting in two slow
 * counter-moving rows behind the copy. Purely decorative — hidden from the
 * accessibility tree, no links, no pointer events; the covers a newcomer
 * recognizes are the hook, the headline stays the message. Each row renders
 * its sequence twice so the CSS -50% translate loops without a seam.
 */
export function HeroPosterWall({ anime }: { anime: AnimeSummary[] }) {
  const covers = anime.filter((a) => a.cover_image);
  if (covers.length < MIN_COVERS) return null;

  const rows = [
    covers.filter((_, i) => i % 2 === 0),
    covers.filter((_, i) => i % 2 === 1),
  ];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      {/* Slight tilt + overscale so the rotated wall still covers the corners. */}
      <div className="absolute inset-0 flex rotate-[-4deg] scale-110 flex-col justify-center gap-3 md:gap-4">
        {rows.map((row, r) => (
          <div
            key={r}
            className={cn("hero-marquee flex w-max", r === 1 && "hero-marquee-reverse")}
            style={{ "--marquee-duration": r === 0 ? "110s" : "150s" } as React.CSSProperties}
          >
            {/* Second copy = the loop's tail; identical on purpose. */}
            {[0, 1].map((copy) => (
              <ul key={copy} className="flex gap-3 pr-3 md:gap-4 md:pr-4">
                {row.map((a) => (
                  <li
                    key={a.id}
                    className="relative h-32 w-[5.5rem] shrink-0 overflow-hidden rounded-md bg-muted md:h-44 md:w-[7.5rem]"
                  >
                    <Image
                      src={a.cover_image!}
                      alt=""
                      fill
                      sizes="(min-width: 768px) 120px, 88px"
                      className="object-cover"
                    />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        ))}
      </div>
      {/* Text protection without killing the art: a light global dim, edge
          melts into the page background, and a radial scrim focused exactly
          behind the copy — covers stay recognizable toward the edges. */}
      <div className="absolute inset-0 bg-background/25" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_62%_at_50%_50%,var(--background)_35%,transparent_78%)]" />
    </div>
  );
}
