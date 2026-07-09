"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AnimeCard } from "@/components/anime/anime-card";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import type { AnimeSummary } from "@/lib/api/client";

/**
 * The quiet-night filler: when nothing of yours airs tonight, the space works
 * for its living instead of sitting empty — personalized picks from
 * /me/recommendations (cache shared with the "For you" page), falling back
 * to the seasonal chart until the recommender has taste signal.
 */
export function QuietNightRecs({ seasonal }: { seasonal: AnimeSummary[] }) {
  const { data, isPending } = useQuery({
    queryKey: ["recommendations"],
    queryFn: async () => {
      const res = await browserApi.GET("/me/recommendations", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  if (isPending) {
    return (
      <div className="flex gap-4 overflow-hidden pt-1">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="aspect-[2/3] w-36 shrink-0 rounded-lg" />
        ))}
      </div>
    );
  }

  const recs = (data?.data ?? []).map((r) => r.anime);
  const picks = (recs.length > 0 ? recs : seasonal).slice(0, 8);
  if (picks.length === 0) return null;

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">
          {recs.length > 0
            ? "Something for tonight instead — picked for your taste:"
            : "Something for tonight instead — big this season:"}
        </p>
        <Link
          href="/recommendations"
          className="shrink-0 text-sm text-muted-foreground hover:text-primary"
        >
          More for you →
        </Link>
      </div>
      <ul className="flex gap-4 overflow-x-auto pb-2">
        {picks.map((a) => (
          <li key={a.id} className="w-36 shrink-0">
            <AnimeCard anime={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}
