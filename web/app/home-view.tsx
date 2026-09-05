import Link from "next/link";
import { ScheduleStrip } from "@/components/anime/schedule-strip";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";
import { currentSeason, seasonLabel } from "@/lib/anime";
import { buildRooms, threadHref } from "@/lib/landing";
import {
  pulseStats,
  roomStatsByEpisode,
  splitConversation,
  talkStatsByAnime,
} from "@/lib/home";
import { cn } from "@/lib/utils";
import { ContinueWatching } from "./home/continue-watching";
import { ConversationGrid } from "./home/conversation-grid";
import { FriendRecs } from "./home/friend-recs";
import { Greeting } from "./home/greeting";
import { PulseBlock } from "./home/pulse";
import { YourEvening } from "./home/your-evening";
import { LiveRooms } from "./live-rooms";
import { OpenParties } from "@/components/parties/open-parties";

// The live layer (busiest threads → rooms, stats, pulse) refreshes faster
// than the catalog's default 5 minutes: the home should visibly move
// between two visits in one evening.
const liveFetch = (input: Request) => fetch(input, { next: { revalidate: 60 } });

/**
 * "Tonight on Cour" — the signed-in front door (§M3.2). The server shell
 * carries everything public (schedule, live rooms, trending talk); the
 * personal rows (your evening, continue watching) are client islands over
 * the viewer's list, since the access token never leaves the browser.
 */
export async function HomeView() {
  const { season, year } = currentSeason();
  const api = serverApi();

  const [seasonRes, scheduleRes, threadsRes, trendingRes] = await Promise.all([
    api.GET("/seasons/{year}/{season}", { params: { path: { year, season } } }).catch(() => null),
    api.GET("/schedule", {}).catch(() => null),
    api
      .GET("/threads/trending", { params: { query: { limit: 10 } }, fetch: liveFetch })
      .catch(() => null),
    api
      .GET("/trending", {
        params: { query: { limit: 24 } },
        fetch: (input: Request) => fetch(input, { next: { revalidate: 120 } }),
      })
      .catch(() => null),
  ]);

  const seasonal = seasonRes?.data?.data ?? [];
  const schedule = scheduleRes?.data?.data ?? [];
  const threads = threadsRes?.data?.data ?? [];
  const trending = trendingRes?.data?.data ?? [];

  if (seasonal.length === 0 && schedule.length === 0 && trending.length === 0) {
    return (
      <PageShell width="browse">
        <section className="flex flex-col items-center gap-4 py-24 text-center">
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            Anime tracking for people watching{" "}
            <span className="text-primary">this season</span>
          </h1>
          <p className="max-w-xl text-balance text-muted-foreground">
            The catalog is still syncing — run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">task seed</code> or give the worker
            a minute, then refresh.
          </p>
        </section>
      </PageShell>
    );
  }

  const rooms = buildRooms(threads);
  const talk = talkStatsByAnime(threads);
  const episodeRooms = roomStatsByEpisode(threads);
  const pulse = pulseStats(threads);
  const { current, revival } = splitConversation(trending, season, year);
  const picks = seasonal.slice(0, 8);

  return (
    <div className="relative isolate">
      {/* Stage lighting: a teal wash behind the evening block that fades
          as the page settles into browsing. */}
      <div aria-hidden className="home-ambient absolute inset-0 -z-10" />

      <PageShell width="browse" className="flex flex-col gap-10 md:gap-14">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Tonight on <span className="text-primary">Cour</span>
          </h1>
          <Greeting />
          {(pulse.recent > 0 || pulse.presence > 0) && (
            <p className="flex items-center gap-2 pt-0.5 font-mono text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
              </span>
              <span>
                {pulse.recent > 0 && (
                  <>
                    <span className="font-semibold text-foreground">{pulse.recent}</span>{" "}
                    comment{pulse.recent === 1 ? "" : "s"} in the last 48 h
                  </>
                )}
                {pulse.recent > 0 && pulse.presence > 0 && " · "}
                {pulse.presence > 0 && (
                  <span className="text-live">
                    {pulse.presence} in room{pulse.presence === 1 ? "" : "s"} right now
                  </span>
                )}
              </span>
            </p>
          )}
        </header>

        {/* ── Your pulse (streak, badges, replies to you) ─────────────── */}
        <PulseBlock />

        {/* ── Your evening + Live now ─────────────────────────────────── */}
        <div
          className={cn(
            "grid gap-8",
            rooms.length > 0 && "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-10",
          )}
        >
          <section aria-labelledby="your-evening" className="min-w-0 space-y-3">
            <h2 id="your-evening" className="text-lg font-semibold tracking-tight">
              Your <span className="text-primary">evening</span>
            </h2>
            <YourEvening schedule={schedule} rooms={episodeRooms} seasonal={picks} />
          </section>

          {rooms.length > 0 && (
            <aside aria-label="Live now" className="min-w-0">
              <div className="rounded-2xl border border-border/60 bg-background/60 p-3 backdrop-blur-md md:p-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
                    </span>
                    Live now
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

        {/* ── Watch parties open right now (renders nothing when none) ── */}
        <OpenParties />

        {/* ── Continue watching (renders nothing when caught up) ─────── */}
        <ContinueWatching />

        {/* ── Friends think you'd like (renders nothing without recs) ─── */}
        <FriendRecs />

        {/* ── The season's conversation ───────────────────────────────── */}
        {current.length > 0 && (
          <section aria-labelledby="season-conversation" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 id="season-conversation" className="text-lg font-semibold tracking-tight">
                The season&apos;s <span className="text-primary">conversation</span>
              </h2>
              <Link href="/trending" className="text-sm text-muted-foreground hover:text-primary">
                Full ranking →
              </Link>
            </div>
            <ConversationGrid anime={current.slice(0, 12)} stats={talk} />
          </section>
        )}

        {/* ── Back in the conversation (the viral-revival story) ─────── */}
        {revival.length > 0 && (
          <section aria-labelledby="back-in-conversation" className="space-y-3">
            <div className="space-y-1">
              <h2 id="back-in-conversation" className="text-lg font-semibold tracking-tight">
                Back in the <span className="text-primary">conversation</span>
              </h2>
              <p className="text-sm text-muted-foreground">
                Not from this season — this week&apos;s talk pulled them back up.
              </p>
            </div>
            <ConversationGrid anime={revival.slice(0, 6)} stats={talk} withSeason />
          </section>
        )}

        {/* ── The week ahead, compact ─────────────────────────────────── */}
        {schedule.length > 0 && (
          <section aria-labelledby="week-schedule" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 id="week-schedule" className="text-lg font-semibold tracking-tight">
                This week&apos;s schedule
              </h2>
              <Link href="/schedule" className="text-sm text-muted-foreground hover:text-primary">
                Full schedule →
              </Link>
            </div>
            <ScheduleStrip entries={schedule.slice(0, 12)} />
          </section>
        )}

        {/* ── Onward ──────────────────────────────────────────────────── */}
        <section aria-label="More to explore" className="grid gap-3 sm:grid-cols-2">
          <ExploreTile
            href="/hidden-gems"
            tint="var(--chart-3)"
            title="Hidden gems"
            sub="High ratings, tiny audiences — be somebody's first recommendation."
            action="Dig in →"
          />
          <ExploreTile
            href={`/seasonal/${year}/${season.toLowerCase()}`}
            tint="var(--chart-2)"
            title={`The full ${seasonLabel(season)} ${year} chart`}
            sub="Every show airing right now — sortable, filterable, yours to raid."
            action="Open the chart →"
          />
        </section>
      </PageShell>
    </div>
  );
}

function ExploreTile({
  href,
  tint,
  title,
  sub,
  action,
}: {
  href: string;
  tint: string;
  title: string;
  sub: string;
  action: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-xl border border-border/60 p-5 transition-colors hover:border-primary/50"
      style={{
        background: `linear-gradient(135deg, color-mix(in oklab, ${tint} 14%, var(--card)), var(--card) 70%)`,
      }}
    >
      <p className="font-semibold tracking-tight">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      <span className="mt-3 inline-block font-mono text-xs text-primary">{action}</span>
    </Link>
  );
}
