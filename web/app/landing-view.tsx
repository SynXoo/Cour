import Image from "next/image";
import Link from "next/link";
import { ScheduleStrip } from "@/components/anime/schedule-strip";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { serverApi } from "@/lib/api/client";
import { currentSeason, displayTitle, seasonLabel } from "@/lib/anime";
import { cn } from "@/lib/utils";
import { buildRooms, heroCovers, threadHref, tonightEntries } from "@/lib/landing";
import { HeroPosterWall } from "./hero-poster-wall";
import { HowItWorks } from "./landing/how-it-works";
import { ProductDemos } from "./landing/product-demos";
import { LiveRooms } from "./live-rooms";
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
  // 26 distinct covers: the wall repeats each row only twice now, so it
  // needs more faces to stay wide enough for the seamless loop.
  const covers = heroCovers(trendingRes?.data?.data ?? [], seasonal, 26);

  const now = new Date();
  // Rooms, not quotes: the live panel never puts a stranger's hot take on
  // the front page (see buildRooms).
  const rooms = buildRooms(threads, now);
  const tonight = tonightEntries(schedule, now);
  const peekHref = threads[0] ? threadHref(threads[0]) : "/schedule";

  // The busiest grid is 2-up from sm and 3-up from lg; an orphan row reads
  // as a mistake, so trailing items hide at widths where they don't fill a
  // row (never below a full first row).
  const even2 = threads.length - (threads.length % 2);
  const even3 = threads.length - (threads.length % 3);

  return (
    <div className="relative isolate">
      {/* Page-length teal ambience the hero melts into — the background
          never collapses to one flat color as you scroll. */}
      <div aria-hidden className="landing-ambient absolute inset-0 -z-10" />

      {/* ── Hero ─────────────────────────────────────────────────────────
          Full-bleed, outside the PageShell. The poster wall drifts behind
          everything; on lg the copy takes the left column and the live
          ticker rides the right as a glass panel — the conversation is part
          of the front door, not a section below it. */}
      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 h-[22rem] w-[30rem] rounded-full bg-primary/10 blur-[100px]"
        />
        <HeroPosterWall anime={covers} />
        {/* The copy track floors at 30rem — the headline's two-line footprint
            — so the first ~20px above lg can't wrap it to three lines. The
            panel absorbs the squeeze; it already renders narrower than that
            under its max-w-md cap below lg. */}
        <div
          className={cn(
            "relative mx-auto grid w-full max-w-[88rem] items-center gap-10 px-4 pb-16 pt-12 md:pt-16 lg:min-h-[36rem] lg:pb-20",
            rooms.length > 0 && "lg:grid-cols-[minmax(30rem,1fr)_minmax(0,30rem)] lg:gap-16",
          )}
        >
          {/* min-w-0 on both grid items: the ticker's nowrap truncate line
              would otherwise widen the implicit track past the viewport.
              w-fit: the column shrink-wraps the copy stack (the paragraph's
              max-w-xl is the widest piece) instead of stretching across the
              track, so the backdrop below can borrow its box as "where the text
              is" — justify-self keeps the shrunk item on the same axis the
              stretched one sat on. */}
          <div
            className={cn(
              "relative isolate flex w-fit min-w-0 flex-col items-center justify-self-center gap-5 text-center",
              rooms.length > 0 && "lg:items-start lg:justify-self-start lg:text-left",
            )}
          >
            {/* Readability lives with the words: this one element is both
                the plate that quiets the posters and the teal bloom,
                inset-anchored to the shrink-wrapped column so it re-centers
                and re-proportions as the text reflows at any width. (The
                wall's mask used to open a hole here instead, aimed from the
                wall's own coordinates — a fixed 50% below lg, a
                five-constant calc() at lg — and its cleared center was
                still narrower than a phone's headline.) The plate melts
                over the inset margins (mask in globals.css), so the spill
                past the text is exactly the inset. `isolate` on the column
                keeps -z-10 above the wall yet under the words. When the
                copy sets ragged-right at lg, --hero-copy-focus slides the
                bloom onto the headline's glyph center — 5rem inset + half
                the 30rem h1, capped at 50% in case the box ever narrows. */}
            <div
              aria-hidden
              className={cn(
                "hero-copy-backdrop pointer-events-none absolute -inset-x-20 -inset-y-14 -z-10",
                rooms.length > 0 && "lg:[--hero-copy-focus:min(20rem,50%)]",
              )}
            />
            {seasonal.length > 0 && (
              <p className="rounded-full border border-border/60 bg-background/60 px-3 py-1 font-mono text-xs text-primary backdrop-blur-sm">
                {seasonLabel(season)} {year} · {seasonal.length} shows airing
              </p>
            )}
            {/* 30rem = the two-line footprint (glyphs wrap at ~29.4rem); the
                old 3xl cap never bound visually but left a 48rem box that
                inflated the column's fit-content and off-centered the glow. */}
            <h1 className="max-w-[30rem] text-balance text-4xl font-bold tracking-tight sm:text-6xl">
              Watch the season <span className="text-primary">together</span>.
            </h1>
            <p className="max-w-xl text-balance text-muted-foreground">
              Live episode threads for every show this season, spoiler-safe by
              your progress. Track what you watch and bring your list from MAL
              or AniList in minutes.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="h-11 rounded-full px-6 text-sm md:h-10">
                <Link href="/register">Join Cour — it&apos;s free</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-full px-6 text-sm md:h-10">
                <Link href={peekHref}>Peek at tonight&apos;s threads</Link>
              </Button>
            </div>
          </div>

          {rooms.length > 0 && (
            <aside
              aria-label="Live on Cour"
              className="mx-auto w-full min-w-0 max-w-md lg:max-w-none"
            >
              <div className="rounded-2xl border border-border/60 bg-background/60 p-3 backdrop-blur-md md:p-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    Live on Cour
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
                <LiveRooms rooms={rooms} />
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
              entries={(tonight.length > 0 ? tonight : schedule).slice(0, 8)}
            />
          </section>
        )}

        {/* ── The tour ───────────────────────────────────────────────────
            What the product does, shown rather than told: three looping
            mock scenes (no data behind them) and the three-step loop. This
            is the newcomer's on-ramp — the live sections above prove it's
            real, this explains what they're looking at. */}
        <section aria-labelledby="tour" className="space-y-5">
          <div className="max-w-2xl space-y-1.5">
            <p className="font-mono text-xs text-primary">How Cour works</p>
            <h2 id="tour" className="text-2xl font-bold tracking-tight sm:text-3xl">
              A tracker that turns into a conversation
            </h2>
            <p className="text-muted-foreground">
              Track what you watch like you already do. The difference is what
              happens the minute an episode airs.
            </p>
          </div>
          <ProductDemos />
          <HowItWorks />
        </section>

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
            <SeasonalCarousel anime={seasonal.slice(0, 10)} />
          </section>
        )}

        {/* ── Closing CTA ────────────────────────────────────────────────
            The last thing a scroller sees: the ask, and the promise that
            sets Cour apart from a streaming site. */}
        <section
          aria-labelledby="join"
          className="relative isolate overflow-hidden rounded-3xl border border-primary/25 px-6 py-10 text-center sm:py-14"
        >
          <div aria-hidden className="cta-ambient absolute inset-0 -z-10" />
          <h2
            id="join"
            className="mx-auto max-w-lg text-balance text-2xl font-bold tracking-tight sm:text-3xl"
          >
            Ready for tonight&apos;s episode?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-balance text-muted-foreground">
            Free to join. Cour never hosts or links to streams — bring your own
            legal source; we&apos;re where you talk about it.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button asChild className="h-11 rounded-full px-6 text-sm md:h-10">
              <Link href="/register">Join Cour</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-full px-6 text-sm md:h-10">
              <Link href={`/seasonal/${year}/${season.toLowerCase()}`}>Browse this season</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Anime metadata provided by{" "}
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
