"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { AnimeCard } from "@/components/anime/anime-card";
import { Skeleton } from "@/components/ui/skeleton";
import { animeHref, displayTitle, formatLabel, seasonLabel } from "@/lib/anime";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { signalChips, youLines, type ExplainedTrending } from "@/lib/trending";
import { cn } from "@/lib/utils";

const EXPLAINED = 12;
const FETCH = 30;

function useExplained(sessionStatus: string) {
  return useQuery({
    // Keyed by session state so the list refetches with the token once the
    // session resolves — that's when `you` fills in.
    queryKey: ["trending", "explained", sessionStatus],
    enabled: sessionStatus !== "loading",
    staleTime: 120_000,
    queryFn: async () => {
      const res = await browserApi.GET("/trending/explained", { params: { query: { limit: FETCH } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });
}

export function TrendingClient() {
  const { status } = useSession();
  const { data, isPending } = useExplained(status);

  if (isPending || !data) {
    return (
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-40 rounded-2xl" />
          </li>
        ))}
      </ul>
    );
  }

  const top = data.data.slice(0, EXPLAINED);
  const rest = data.data.slice(EXPLAINED);

  if (top.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
        The first trending recompute hasn&apos;t run yet — give the worker a minute.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="explained">
        {top.map((item) => (
          <li key={item.anime.id}>
            <ExplainedCard item={item} />
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <section aria-labelledby="also-rising" className="space-y-3">
          <div className="space-y-1">
            <h2 id="also-rising" className="text-lg font-semibold tracking-tight">
              Also rising
            </h2>
            <p className="text-sm text-muted-foreground">Ranks {EXPLAINED + 1}–{EXPLAINED + rest.length}.</p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-4 gap-y-6">
            {rest.map((item) => (
              <li key={item.anime.id} className="relative">
                <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded-md bg-background/85 px-1.5 py-0.5 font-mono text-xs font-semibold backdrop-blur-sm">
                  #{item.rank}
                </span>
                <AnimeCard anime={item.anime} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.computed_at && (
        <p className="font-mono text-xs text-muted-foreground">
          Recomputed {new Date(data.computed_at).toLocaleTimeString()} · refreshes every 15 minutes
        </p>
      )}
    </div>
  );
}

function ExplainedCard({ item }: { item: ExplainedTrending }) {
  const a = item.anime;
  const chips = signalChips(item.signals);
  const lines = youLines(item.you);
  const meta = [formatLabel(a.format), a.season && a.season_year ? `${seasonLabel(a.season)} ${a.season_year}` : null]
    .filter(Boolean)
    .join(" · ");
  const podium = item.rank <= 3;

  return (
    <article
      className={cn(
        "tint-card flex h-full gap-3 rounded-2xl border p-3",
        podium && "border-primary/40",
      )}
      style={a.cover_color ? ({ "--tint": a.cover_color } as React.CSSProperties) : undefined}
    >
      <div className="flex shrink-0 flex-col items-center gap-2">
        <span
          className={cn(
            "font-mono text-xl font-bold tabular-nums",
            podium ? "text-primary" : "text-muted-foreground",
          )}
        >
          #{item.rank}
        </span>
        <Link
          href={animeHref(a)}
          tabIndex={-1}
          aria-hidden
          className="relative h-28 w-20 overflow-hidden rounded-md bg-muted"
        >
          {a.cover_image && <Image src={a.cover_image} alt="" fill sizes="80px" className="object-cover" />}
        </Link>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <Link href={animeHref(a)} className="line-clamp-2 text-sm font-semibold leading-snug hover:text-primary">
            {displayTitle(a)}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">
            {meta}
            {a.average_score != null && <span className="text-gold"> · ★ {a.average_score}</span>}
          </p>
        </div>
        {chips.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Why it's trending">
            {chips.map((c) => (
              <li
                key={c.key}
                className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 font-mono text-[11px] text-foreground"
              >
                {c.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-mono text-[11px] text-muted-foreground">Carried by AniList&apos;s own trending signal</p>
        )}
        {lines.length > 0 && (
          <ul className="space-y-0.5 text-xs" aria-label="Why it matters to you">
            {lines.map((l, i) => (
              <li key={l} className={cn(i === 0 ? "text-live" : "text-muted-foreground")}>
                {l}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
