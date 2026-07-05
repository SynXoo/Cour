import Image from "next/image";
import Link from "next/link";
import type { AnimeSummary } from "@/lib/api/client";
import { animeHref, displayTitle, formatLabel, untilLabel } from "@/lib/anime";

export function AnimeCard({ anime, priority = false }: { anime: AnimeSummary; priority?: boolean }) {
  const title = displayTitle(anime);
  const format = formatLabel(anime.format);

  return (
    <Link
      href={animeHref(anime)}
      className="group flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border/60 bg-muted"
        style={anime.cover_color ? { backgroundColor: anime.cover_color } : undefined}
      >
        {anime.cover_image ? (
          <Image
            src={anime.cover_image}
            alt=""
            fill
            priority={priority}
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 200px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
            {title}
          </div>
        )}
        {anime.average_score != null && (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-xs font-semibold backdrop-blur-sm">
            {anime.average_score}%
          </span>
        )}
        {anime.next_airing_at && anime.next_airing_episode != null && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-black/0 px-2 pb-1.5 pt-5 text-xs text-white">
            Ep {anime.next_airing_episode} {untilLabel(anime.next_airing_at)}
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">
          {[format, anime.episodes_count ? `${anime.episodes_count} ep` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </Link>
  );
}
