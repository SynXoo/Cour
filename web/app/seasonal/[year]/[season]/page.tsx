import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { serverApi, type Season } from "@/lib/api/client";
import { SEASONS, nextSeason, prevSeason, seasonLabel } from "@/lib/anime";
import { SeasonalView } from "./seasonal-view";

type Params = { year: string; season: string };

function parseParams(params: Params): { year: number; season: Season } | null {
  const year = Number(params.year);
  const season = params.season.toUpperCase() as Season;
  if (!Number.isInteger(year) || year < 1940 || year > 2100) return null;
  if (!SEASONS.includes(season)) return null;
  return { year, season };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const parsed = parseParams(await params);
  if (!parsed) return {};
  return {
    title: `${seasonLabel(parsed.season)} ${parsed.year} Anime`,
    description: `Every anime airing in the ${seasonLabel(parsed.season)} ${parsed.year} season — charts, air dates, and discussion on Cour.`,
  };
}

export default async function SeasonalPage({ params }: { params: Promise<Params> }) {
  const parsed = parseParams(await params);
  if (!parsed) notFound();
  const { year, season } = parsed;

  const res = await serverApi()
    .GET("/seasons/{year}/{season}", { params: { path: { year, season } } })
    .catch(() => null);
  const anime = res?.data?.data ?? [];

  const prev = prevSeason(season, year);
  const next = nextSeason(season, year);

  return (
    <PageShell width="browse" className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {seasonLabel(season)} {year}
        </h1>
        <nav aria-label="Season navigation" className="flex gap-2 text-sm">
          <Link
            href={`/seasonal/${prev.year}/${prev.season.toLowerCase()}`}
            className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:border-primary/50 hover:text-foreground"
          >
            ← {seasonLabel(prev.season)} {prev.year}
          </Link>
          <Link
            href={`/seasonal/${next.year}/${next.season.toLowerCase()}`}
            className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:border-primary/50 hover:text-foreground"
          >
            {seasonLabel(next.season)} {next.year} →
          </Link>
        </nav>
      </header>

      {anime.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-muted-foreground">
          No titles synced for this season yet.
        </p>
      ) : (
        // useSearchParams needs a Suspense boundary; the header above stays in
        // the prerendered HTML while the interactive grid hydrates.
        <Suspense fallback={null}>
          <SeasonalView anime={anime} />
        </Suspense>
      )}
    </PageShell>
  );
}
