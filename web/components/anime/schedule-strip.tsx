import Image from "next/image";
import Link from "next/link";
import type { ScheduleEntry } from "@/lib/api/client";
import { displayTitle, untilLabel } from "@/lib/anime";

export function ScheduleStrip({ entries }: { entries: ScheduleEntry[] }) {
  return (
    <ul className="flex gap-3 overflow-x-auto pb-2">
      {entries.map((e) => (
        <li key={`${e.anime.id}-${e.episode}`} className="w-56 shrink-0">
          <Link
            href={`/anime/${e.anime.id}/episode/${e.episode}`}
            className="flex h-full items-center gap-3 rounded-lg border border-border/60 bg-card p-2.5 transition-colors hover:border-primary/50"
          >
            <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
              {e.anime.cover_image && (
                <Image src={e.anime.cover_image} alt="" fill sizes="48px" className="object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayTitle(e.anime)}</p>
              <p className="font-mono text-xs text-muted-foreground">
                Ep {e.episode} · <span className="text-primary">{untilLabel(e.airing_at)}</span>
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
