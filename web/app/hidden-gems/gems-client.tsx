"use client";

import { useMemo, useState } from "react";
import { AnimeCard } from "@/components/anime/anime-card";
import { Chip } from "@/components/ui/chip";
import type { AnimeSummary } from "@/lib/api/client";
import { GEM_GROUPS, filterGems, gemGroup, gemReason, type GemGroup } from "@/lib/gems";
import { cn } from "@/lib/utils";

/**
 * Format chips over the gems rail, plus the one-line reason under each
 * card. The API already ranks full shows above shorts; the chips let a
 * reader who *wants* a 10-minute OVA find them without scrolling past TV.
 */
export function GemsClient({ anime }: { anime: AnimeSummary[] }) {
  const [group, setGroup] = useState<GemGroup>("all");
  const counts = useMemo(() => {
    const c: Record<GemGroup, number> = { all: anime.length, tv: 0, movies: 0, shorts: 0 };
    for (const a of anime) c[gemGroup(a.format)]++;
    return c;
  }, [anime]);
  const visible = filterGems(anime, group);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Format">
        {GEM_GROUPS.map((g) => (
          <Chip key={g.value} active={group === g.value} onClick={() => setGroup(g.value)}>
            {g.label}
            <span className={cn("font-mono text-[11px]", group === g.value ? "opacity-80" : "opacity-60")}>
              {counts[g.value]}
            </span>
          </Chip>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          No gems in that format right now.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-6" data-testid="gems">
          {visible.map((a, i) => (
            <li key={a.id} className="flex flex-col gap-1">
              <AnimeCard anime={a} priority={i < 6} />
              <p className="font-mono text-[11px] text-muted-foreground">
                <span className="text-gold">{gemReason(a).split(" · ")[0]}</span> · {gemReason(a).split(" · ")[1]}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
