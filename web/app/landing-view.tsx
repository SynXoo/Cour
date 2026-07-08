import Image from "next/image";
import Link from "next/link";
import { ScheduleStrip } from "@/components/anime/schedule-strip";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { serverApi, type ThreadComment } from "@/lib/api/client";
import { currentSeason, displayTitle, seasonLabel } from "@/lib/anime";
import { cn } from "@/lib/utils";
import { buildTicker, heroCovers, threadHref, tonightEntries } from "@/lib/landing";
import { HeroPosterWall } from "./hero-poster-wall";
import { LiveTicker } from "./live-ticker";
import { SeasonalCarousel } from "./seasonal-carousel";

// The live-proof data (busiest threads + their newest comments) refreshes
// faster than the catalog fetches' default 5 minutes — a landing page that
// visibly moves is the pitch.
const liveFetch = (input: Request) => fetch(input, { next: { revalidate: 60 } });

/** The logged-out front door: the product demoing itself. */
export async function LandingView() {
  const { season, year } = currentSeason();
  const api = serverApi();

  const [seasonRes, scheduleRes, threadsRes, trendingRes] = await Promise.all([
    api.GET("/seasons/{year}/{season}", { params: { path: { year, season } } }).catch(() => null),
    api.GET("/schedule", {}).catch(() => null),
    api
      .GET("/threads/trending", { params: { query: { limit: 6 } }, fetch: liveFetch })
      .catch(() => null),
    // Deep pool on purpose: heroCovers mines it for both trending rank and
    // the all-time household names a newcomer recognizes.
    api.GET("/trending", { params: { query: { limit: 40 } } }).catch(() => null),
  ]);

  const seasonal = seasonRes?.data?.data ?? [];
  const schedule = scheduleRes?.data?.data ?? [];
  const threads = threadsRes?.data?.data ?? [];
  const covers = heroCovers(trendingRes?.data?.data ?? [], seasonal);

  // Newest comments from the top few threads with actual chatter feed the
  // ticker. Threads are publicly readable, so visitors see the real thing.
  const chattering = threads.filter((t) => t.recent_comments > 0).slice(0, 3);
  const commentPages = await Promise.all(
    chattering.map((t) =>
      api
        .GET("/threads/{threadId}/comments", {
          params: { path: { threadId: t.thread.id }, query: { limit: 10 } },
          fetch: liveFetch,
        })
        .catch(() => null),
    ),
  );
  const commentsByThread = new Map<number, ThreadComment[]>(
    chattering.map((t, i) => [t.thread.id, commentPages[i]?.data?.data ?? []]),
  );

  const now = new Date();
  const ticker = buildTicker(threads, commentsByThread, now);
  const tonight = tonightEntries(schedule, now);
  const peekHref = threads[0] ? threadHref(threads[0]) : "/schedule";

  // The busiest grid is 2-up from sm and 3-up from lg; an orphan row reads
  // as a mistake, so trailing items hide at widths where they don't fill a
  // row (never below a full first row).
  const even2 = threads.length - (threads.length % 2);
  const even3 = threads.length - (threads.length % 3);

  return (
    <div className="relative isolate">
      {/* Page-length violet ambience the hero melts into — the background
          never collapses to one flat color as you scroll. */}
      <div aria-hidden className="landing-ambient absolute inset-0 -z-10" />

      {/* ── Hero ─────────────────────────────────────────────────────────
          Full-bleed, outside the PageShell. The poster wall drifts behind
          everything; on lg the copy takes the left column and the live
          ticker rides the right as a glass panel — the conversation is part
          of the front door, not a section below it. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 h-[26rem] w-[40rem] max-w-full -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 h-[22rem] w-[30rem] rounded-full bg-primary/10 blur-[100px]"
        />
        <HeroPosterWall anime={covers} />
        <div
          className={cn(
            "relative mx-auto grid w-full max-w-[88rem] items-center gap-10 px-4 pb-16 pt-12 md:pt-16 lg:min-h-[36rem] lg:pb-20",
            ticker.length > 0 && "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16",
          )}
        >
          {/* min-w-0 on both grid items: the ticker's nowrap truncate line
              would otherwise widen the implicit track past the viewport. */}
          <div
            className={cn(
              "flex min-w-0 flex-col items-center gap-5 text-center",
              ticker.length > 0 && "lg:items-start lg:text-left",
            )}
          >
            {seasonal.length > 0 && (
              <p className="font-mono text-xs text-primary">
                {seasonLabel(season)} {year} · {seasonal.length} shows airing
              </p>
            )}
            <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-6xl">
              Watch the season <span className="text-primary">together</span>.
            </h1>
            <p className="max-w-xl text-balance text-muted-foreground">
              Live episode threads for every show this season, spoiler-safe by
              your progress. Track what you watch and bring your list from MAL
              or AniList in minutes.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="h-11 px-6 text-sm md:h-9">
                <Link href="/register">Join Cour</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 px-6 text-sm md:h-9">
                <Link href={peekHref}>Peek at tonight&apos;s threads</Link>
              </Button>
            </div>
          </div>

          {ticker.length > 0 && (
            <aside
              aria-label="Right now on Cour"
              className="mx-auto w-full min-w-0 max-w-md lg:max-w-none"
            >
              <div className="rounded-xl border border-border/60 bg-background/60 p-3 backdrop-blur-md md:p-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    Right now on Cour
                  </h2>
                  {threads[0] && (
                    <Link
                      href={threadHref(threads[0])}
                      className="text-xs text-muted-foreground hover:text-primary"
                    >
                      Jump in →
                    </Link>
                  )}
                </div>
                <LiveTicker items={ticker} />
              </div>
            </aside>
          )}
        </div>
      </section>

      <PageShell width="browse" className="flex flex-col gap-12 md:gap-16">
        {/* ── Tonight ────────────────────────────────────────────────────── */}
        {(tonight.length > 0 || schedule.length > 0) && (
          <section aria-labelledby="tonight" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 id="tonight" className="text-lg font-semibold tracking-tight">
                {tonight.length > 0 ? "Tonight's episodes" : "Airing next"}
              </h2>
              <Link href="/schedule" className="text-sm text-muted-foreground hover:text-primary">
                Full schedule →
              </Link>
            </div>
            <ScheduleStrip
              entries={(tonight.length > 0 ? tonight : schedule).slice(0, 12)}
            />
          </section>
        )}

        {/* ── Busiest threads ────────────────────────────────────────────── */}
        {threads.length > 0 && (
          <section aria-labelledby="busiest" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 id="busiest" className="text-lg font-semibold tracking-tight">
                The season&apos;s busiest threads
              </h2>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {threads.map((t, i) => (
                // min-w-0: a grid item's min-width is auto, and the nowrap
                // truncate title would otherwise widen the track past the row.
                <li
                  key={t.thread.id}
                  className={cn(
                    "min-w-0",
                    even2 >= 2 && i >= even2 && "sm:max-lg:hidden",
                    even3 >= 3 && i >= even3 && "lg:hidden",
                  )}
                >
                  <Link
                    href={threadHref(t)}
                    className="flex h-full items-center gap-3 rounded-lg border border-border/60 bg-card p-2.5 transition-colors hover:border-primary/50"
                  >
                    <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
                      {t.anime.cover_image && (
                        <Image
                          src={t.anime.cover_image}
                          alt=""
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{displayTitle(t.anime)}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {t.episode ? `Ep ${t.episode.number} thread` : "Series talk"} ·{" "}
                        {t.thread.comment_count} comment{t.thread.comment_count === 1 ? "" : "s"}
                        {t.presence > 0 && (
                          <span className="text-primary"> · {t.presence} in there now</span>
                        )}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Seasonal rail ──────────────────────────────────────────────── */}
        {seasonal.length > 0 && (
          <section aria-labelledby="season-preview" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 id="season-preview" className="text-lg font-semibold tracking-tight">
                {seasonLabel(season)} {year} — popular this season
              </h2>
              <Link
                href={`/seasonal/${year}/${season.toLowerCase()}`}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                Full chart →
              </Link>
            </div>
            <SeasonalCarousel anime={seasonal.slice(0, 14)} />
          </section>
        )}

        {/* ── The deal ───────────────────────────────────────────────────── */}
        <section
          aria-label="What Cour is"
          className="mx-auto w-full max-w-3xl rounded-lg border border-border/60 bg-card p-6 text-center"
        >
          <p className="font-medium">
            Cour never hosts or links to streams — bring your own legal source.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            We&apos;re where you talk about it. Anime metadata provided by{" "}
            <a
              href="https://anilist.co"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              AniList
            </a>
            .
          </p>
        </section>
      </PageShell>
    </div>
  );
}
