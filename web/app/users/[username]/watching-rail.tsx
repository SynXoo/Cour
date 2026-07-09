"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Progress } from "@/components/ui/progress";
import { animeHref, displayTitle } from "@/lib/anime";
import type { UserProfile } from "@/lib/profile";

/**
 * The currently-watching rail, kept from the old profile but dressed like
 * home's continue-watching: each card tinted by its own cover color, with a
 * real progress bar under the art.
 */
export function WatchingRail({ entries }: { entries: UserProfile["currently_watching"] }) {
  return (
    <section aria-labelledby="watching-heading" className="space-y-3">
      <h2 id="watching-heading" className="tint-ink text-lg font-semibold tracking-tight">
        Currently watching
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {entries.map(({ anime, progress }) => {
          const pct =
            anime.episodes_count && anime.episodes_count > 0
              ? Math.min(100, (progress / anime.episodes_count) * 100)
              : null;
          return (
            <li
              key={anime.id}
              className="tint-card w-36 shrink-0 rounded-lg border border-border/60 p-2"
              style={anime.cover_color ? ({ "--tint": anime.cover_color } as CSSProperties) : undefined}
            >
              <Link href={animeHref(anime)} className="group block space-y-1.5">
                <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-muted">
                  {anime.cover_image && (
                    <Image
                      src={anime.cover_image}
                      alt=""
                      fill
                      sizes="144px"
                      className="object-cover transition-transform group-hover:scale-105"
                    />
                  )}
                </div>
                {pct != null && <Progress value={pct} aria-hidden className="h-1.5" />}
                <p className="font-mono text-xs text-muted-foreground">
                  Ep {progress}
                  {anime.episodes_count ? `/${anime.episodes_count}` : ""}
                </p>
                <p className="line-clamp-2 text-xs leading-snug group-hover:text-primary">
                  {displayTitle(anime)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
