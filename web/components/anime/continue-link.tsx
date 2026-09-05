"use client";

import Link from "next/link";
import { useMyListEntry } from "@/lib/hooks/use-list";
import { nextUpNumber, type Episode } from "@/lib/episodes";

/**
 * "Continue · Ep N" in the anime header's action bar (§M3.10): the one
 * link a returning viewer actually wants. Renders nothing until the list
 * entry resolves, and never for a caught-up or untracked show.
 */
export function ContinueLink({ animeId, episodes }: { animeId: number; episodes: Episode[] }) {
  const { data: entry } = useMyListEntry(animeId);
  if (!entry) return null;
  const next = nextUpNumber(episodes, entry.progress);
  if (next == null) return null;
  return (
    <Link
      href={`/anime/${animeId}/episode/${next}`}
      className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 font-mono text-sm text-primary transition-colors hover:bg-primary/20"
    >
      Continue · Ep {next}
    </Link>
  );
}
