import type { components } from "@/lib/api/schema";
import { airDateLabel, isUpcoming, untilLabel } from "@/lib/anime";

type Episode = components["schemas"]["Episode"];

// Episode rows become links into per-episode discussion threads when the
// discussions slice lands; until then they present the airing calendar.
export function EpisodeList({ episodes }: { episodes: Episode[] }) {
  return (
    <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {episodes.map((e) => {
        const upcoming = isUpcoming(e.airing_at);
        return (
          <li
            key={e.number}
            className="flex items-baseline justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2 text-sm"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-semibold">Ep {e.number}</span>
              {e.title && <span className="truncate text-muted-foreground">{e.title}</span>}
            </span>
            {e.airing_at && (
              <span
                className={`shrink-0 text-xs ${upcoming ? "text-primary" : "text-muted-foreground"}`}
                title={airDateLabel(e.airing_at)}
              >
                {upcoming ? untilLabel(e.airing_at) : airDateLabel(e.airing_at)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
