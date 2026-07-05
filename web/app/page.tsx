import Link from "next/link";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { ScheduleStrip } from "@/components/anime/schedule-strip";
import { serverApi } from "@/lib/api/client";
import { currentSeason, seasonLabel } from "@/lib/anime";

export default async function HomePage() {
  const { season, year } = currentSeason();
  const api = serverApi();

  const [seasonRes, scheduleRes, trendingRes] = await Promise.all([
    api.GET("/seasons/{year}/{season}", { params: { path: { year, season } } }).catch(() => null),
    api.GET("/schedule", {}).catch(() => null),
    api
      .GET("/trending", {
        params: { query: { limit: 12 } },
        fetch: (input: Request) => fetch(input, { next: { revalidate: 120 } }),
      })
      .catch(() => null),
  ]);

  const seasonal = seasonRes?.data?.data ?? [];
  const schedule = scheduleRes?.data?.data ?? [];
  const trending = trendingRes?.data?.data ?? [];

  if (seasonal.length === 0) {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Anime tracking for people watching{" "}
          <span className="text-primary">this season</span>
        </h1>
        <p className="max-w-xl text-balance text-muted-foreground">
          The catalog is still syncing — run <code className="rounded bg-muted px-1.5 py-0.5">task seed</code>{" "}
          or give the worker a minute, then refresh.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-10 py-2">
      {schedule.length > 0 && (
        <section aria-labelledby="airing-next" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="airing-next" className="text-lg font-semibold tracking-tight">
              Airing next
            </h2>
            <Link href="/schedule" className="text-sm text-muted-foreground hover:text-primary">
              Full schedule →
            </Link>
          </div>
          <ScheduleStrip entries={schedule.slice(0, 12)} />
        </section>
      )}

      {trending.length > 0 && (
        <section aria-labelledby="trending-now" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="trending-now" className="text-lg font-semibold tracking-tight">
              <span className="text-primary">Trending</span> right now
            </h2>
            <Link href="/trending" className="text-sm text-muted-foreground hover:text-primary">
              Full ranking →
            </Link>
          </div>
          <AnimeGrid anime={trending} priorityCount={6} />
        </section>
      )}

      <section aria-labelledby="this-season" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="this-season" className="text-lg font-semibold tracking-tight">
            {seasonLabel(season)} {year} — popular this season
          </h2>
          <Link
            href={`/seasonal/${year}/${season.toLowerCase()}`}
            className="text-sm text-muted-foreground hover:text-primary"
          >
            Full chart →
          </Link>
        </div>
        <AnimeGrid anime={seasonal.slice(0, 12)} priorityCount={6} />
      </section>
    </div>
  );
}
