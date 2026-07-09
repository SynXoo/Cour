import Link from "next/link";
import { AnimeCard } from "@/components/anime/anime-card";
import { seasonLabel } from "@/lib/anime";
import type { AnimeSummary } from "@/lib/api/client";
import type { AnimeTalkStats } from "@/lib/home";

/**
 * Trending posters reframed as conversations: under each card, the show's
 * talk stats (from the trending-threads window) link straight into its
 * hottest room. Shows without a hot thread just render the card — the stat
 * line is proof, not filler. `withSeason` marks the revival row, where the
 * whole story is *when* the show is from.
 */
export function ConversationGrid({
  anime,
  stats,
  withSeason = false,
}: {
  anime: AnimeSummary[];
  stats: Record<number, AnimeTalkStats>;
  withSeason?: boolean;
}) {
  if (anime.length === 0) return null;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-6">
      {anime.map((a) => {
        const talk = stats[a.id];
        const active = talk && (talk.recent > 0 || talk.presence > 0);
        return (
          <li key={a.id} className="relative flex min-w-0 flex-col gap-1.5">
            <AnimeCard anime={a} />
            {withSeason && a.season && a.season_year != null && (
              <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-background/85 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary backdrop-blur-sm">
                {seasonLabel(a.season)} {a.season_year}
              </span>
            )}
            {active && (
              <Link
                href={talk.href}
                className="group/talk font-mono text-xs text-muted-foreground hover:text-primary"
              >
                {talk.recent > 0 && (
                  <span>
                    {talk.recent} comment{talk.recent === 1 ? "" : "s"} in 2 days
                  </span>
                )}
                {talk.recent > 0 && talk.presence > 0 && " · "}
                {talk.presence > 0 && <span className="text-primary">{talk.presence} in now</span>}
                <span className="block truncate text-primary/80 group-hover/talk:text-primary">
                  {talk.label} →
                </span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
