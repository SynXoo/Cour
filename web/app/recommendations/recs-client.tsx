"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import { animeHref, displayTitle, formatLabel, seasonLabel } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";

export function RecommendationsClient() {
  const { status } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: ["recommendations"],
    enabled: status === "authed",
    queryFn: async () => {
      const res = await browserApi.GET("/me/recommendations", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  if (status === "anon") {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">For you</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Rate and favorite a few shows and Cour finds people with your taste —
          then shows you what they&apos;re watching.
        </p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  const items = data?.data ?? [];

  return (
    <div className="flex flex-col gap-6 py-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">For you</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {data?.cold_start
            ? "Score a few shows 8+ or add favorites, and these turn personal — for now, here's what's moving on Cour."
            : "From users whose taste overlaps yours, biased toward what's airing. Every pick says why."}
        </p>
      </header>

      {isLoading || status === "loading" ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-28 rounded-lg" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          Not enough signal yet — track and rate a few shows first.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map(({ anime, reasons }) => (
            <li key={anime.id}>
              <Link
                href={animeHref(anime)}
                className="flex h-full gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/50"
              >
                <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded bg-muted">
                  {anime.cover_image && (
                    <Image src={anime.cover_image} alt="" fill sizes="80px" className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="line-clamp-2 font-medium">{displayTitle(anime)}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {[
                      formatLabel(anime.format),
                      anime.season && anime.season_year
                        ? `${seasonLabel(anime.season)} ${anime.season_year}`
                        : null,
                      anime.average_score != null ? `★ ${anime.average_score}%` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <ul className="space-y-0.5">
                    {reasons.map((r) => (
                      <li key={r} className="text-xs text-primary">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
