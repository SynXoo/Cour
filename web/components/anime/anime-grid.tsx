import type { AnimeSummary } from "@/lib/api/client";
import { AnimeCard } from "./anime-card";

export function AnimeGrid({
  anime,
  priorityCount = 0,
}: {
  anime: AnimeSummary[];
  priorityCount?: number;
}) {
  if (anime.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        Nothing here yet.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-6">
      {anime.map((a, i) => (
        <li key={a.id}>
          <AnimeCard anime={a} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
