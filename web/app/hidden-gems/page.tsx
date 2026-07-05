import type { Metadata } from "next";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { serverApi } from "@/lib/api/client";

export const metadata: Metadata = {
  title: "Hidden Gems",
  description:
    "Recent anime with great ratings and small audiences — the shows the popularity charts bury.",
};

export default async function HiddenGemsPage() {
  const res = await serverApi()
    .GET("/hidden-gems", {
      fetch: (input: Request) => fetch(input, { next: { revalidate: 300 } }),
    })
    .catch(() => null);

  const anime = res?.data?.data ?? [];

  return (
    <div className="flex flex-col gap-6 py-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Hidden Gems</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Recent seasons, high ratings, low popularity — a deliberate inversion
          of the big-list bias. Somebody has to watch these first; may as well
          be you.
        </p>
      </header>

      {anime.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          No gems surfaced yet — the discovery job runs every 15 minutes.
        </p>
      ) : (
        <AnimeGrid anime={anime} priorityCount={6} />
      )}
    </div>
  );
}
