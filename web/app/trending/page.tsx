import type { Metadata } from "next";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";

export const metadata: Metadata = {
  title: "Trending Now",
  description:
    "What people are actually watching and talking about right now — recent activity with time decay, not all-time popularity.",
};

export default async function TrendingPage() {
  const res = await serverApi()
    .GET("/trending", {
      params: { query: { limit: 60 } },
      fetch: (input: Request) => fetch(input, { next: { revalidate: 120 } }),
    })
    .catch(() => null);

  const anime = res?.data?.data ?? [];
  const computedAt = res?.data?.computed_at;

  return (
    <PageShell width="browse" className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Trending Now</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ranked by what Cour users are adding, finishing, reviewing, and
          arguing about — with exponential time decay, so hype has to be{" "}
          <em>current</em> to count. Explicitly not an all-time list.
        </p>
        {computedAt && (
          <p className="text-xs text-muted-foreground">
            Recomputed {new Date(computedAt).toLocaleTimeString()} · refreshes every 15 minutes
          </p>
        )}
      </header>

      {anime.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          The first trending recompute hasn&apos;t run yet — give the worker a minute.
        </p>
      ) : (
        <AnimeGrid anime={anime} priorityCount={6} />
      )}
    </PageShell>
  );
}
