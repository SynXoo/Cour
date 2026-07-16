"use client";

import { HeartIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { PageShell } from "@/components/page-shell";
import { useSession } from "@/lib/auth/session";
import {
  formatWatchTime,
  libraryTotal,
  profileTint,
  watchTimeFraming,
  type LibraryFilter,
  type ProfileBanner,
  type UserProfile,
} from "@/lib/profile";
import { CountUp } from "./count-up";
import { EraStrip } from "./era-strip";
import { FormatSplit } from "./format-split";
import { GenreBars } from "./genre-bars";
import { HabitTiles } from "./habit-tiles";
import { LibrarySection } from "./library-section";
import { ProfileHero } from "./profile-hero";
import { ScoreHistogram } from "./score-histogram";
import { TasteCard } from "./taste-card";
import { WatchingRail } from "./watching-rail";

/**
 * Client root for the whole profile: the banner pick must repaint the hero
 * and the page accent instantly, and a histogram/genre/era/format click must
 * land in the library tabs — one component tree keeps that state in plain
 * props. SSR still renders all of it; only the library pages fetch
 * client-side.
 */
export function ProfileView({ profile }: { profile: UserProfile }) {
  const { user } = useSession();
  const isOwner = user?.username === profile.username;

  const [banner, setBanner] = useState<ProfileBanner | null>(profile.banner);
  const [bio, setBio] = useState(profile.bio);
  const [accent, setAccent] = useState<string | null>(profile.accent_color);
  // Hovering a swatch repaints the whole page before anything is saved.
  const [accentPreview, setAccentPreview] = useState<string | null>(null);
  const tint = profileTint(accentPreview ?? accent, banner, profile.favorites);

  const stats = profile.stats;
  const total = libraryTotal(stats.counts);
  const [filter, setFilter] = useState<LibraryFilter>(() => ({
    status: STATUS_ORDER.find((s) => stats.counts[s] > 0) ?? "watching",
    score: null,
    genre: null,
    year: null,
    format: null,
  }));
  const librarySection = useRef<HTMLElement>(null);

  const jumpToLibrary = (patch: Partial<LibraryFilter>) => {
    // A stat click widens to "all" by default: the histogram counts every
    // status, so landing on a narrower tab would silently drop matches. The
    // era strip overrides it — that chart only ever counted completed shows.
    setFilter((f) => ({ ...f, status: "all", ...patch }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    librarySection.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const watchTime = formatWatchTime(stats.watch_minutes);
  const framing = watchTimeFraming(stats.watch_minutes);
  const hasTaste = stats.score_bias != null || stats.score_stddev != null;

  return (
    <div style={tint ? ({ "--tint": tint } as CSSProperties) : undefined}>
      <PageShell width="browse" className="flex flex-col gap-10">
        <ProfileHero
          profile={profile}
          isOwner={isOwner}
          banner={banner}
          bio={bio}
          accent={accent}
          onBannerChange={setBanner}
          onBioChange={setBio}
          onAccentPreview={setAccentPreview}
          onAccentChange={(hex) => {
            setAccent(hex);
            setAccentPreview(null);
          }}
        />

        <section aria-labelledby="stats-heading" className="flex flex-col gap-8">
          <h2 id="stats-heading" className="sr-only">
            Statistics
          </h2>

          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <p className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                {watchTime ? (
                  <>
                    <span aria-hidden>≈ </span>
                    <CountUp
                      className="tint-ink"
                      value={stats.watch_minutes}
                      format={formatWatchTimeFrame}
                    />
                  </>
                ) : (
                  <span className="text-muted-foreground">0h</span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {watchTime ? "in front of the screen" : "no episodes logged yet"}
              </p>
              {framing && (
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {framing.yearPercent.toFixed(1)}% of a year · {framing.films} feature films
                </p>
              )}
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <StatTile label="Episodes" value={stats.episodes_watched} format={integer} />
              <StatTile
                label={stats.rated_count > 0 ? `Mean of ${stats.rated_count} rated` : "Mean score"}
                value={stats.mean_score}
                format={oneDecimal}
              />
              <StatTile label="Shows" value={total} format={integer} />
            </dl>
          </div>

          {hasTaste && (
            <TasteCard
              bias={stats.score_bias}
              stddev={stats.score_stddev}
              ratedCount={stats.rated_count}
            />
          )}

          {(stats.rated_count > 0 || stats.genres.length > 0) && (
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-3">
                <h3 className="tint-ink text-sm font-semibold uppercase tracking-wide">
                  Score distribution
                </h3>
                <ScoreHistogram
                  histogram={stats.score_histogram}
                  ratedCount={stats.rated_count}
                  username={profile.username}
                  onPick={(score) => jumpToLibrary({ score })}
                />
              </div>
              {stats.genres.length > 0 && (
                <div className="space-y-3">
                  <h3 className="tint-ink text-sm font-semibold uppercase tracking-wide">
                    Genres
                  </h3>
                  <GenreBars genres={stats.genres} onPick={(genre) => jumpToLibrary({ genre })} />
                </div>
              )}
            </div>
          )}

          {(stats.season_counts.length > 0 || stats.format_counts.length > 0) && (
            <div className="grid gap-8 lg:grid-cols-2">
              {stats.season_counts.length > 0 && (
                <EraStrip
                  seasons={stats.season_counts}
                  onPick={(year) => jumpToLibrary({ year, status: "completed" })}
                />
              )}
              {stats.format_counts.length > 0 && (
                <FormatSplit
                  formats={stats.format_counts}
                  onPick={(format) => jumpToLibrary({ format })}
                />
              )}
            </div>
          )}

          <HabitTiles stats={stats} longestCompleted={stats.longest_completed} />
        </section>

        <LibrarySection
          ref={librarySection}
          username={profile.username}
          counts={stats.counts}
          filter={filter}
          onFilterChange={setFilter}
        />

        {profile.currently_watching.length > 0 && (
          <WatchingRail entries={profile.currently_watching} />
        )}

        {profile.favorites.length > 0 ? (
          <section aria-labelledby="favorites-heading" className="space-y-3">
            <h2 id="favorites-heading" className="tint-ink text-lg font-semibold tracking-tight">
              Favorites
            </h2>
            <AnimeGrid anime={profile.favorites} />
          </section>
        ) : (
          isOwner && (
            <section aria-labelledby="favorites-heading" className="space-y-3">
              <h2 id="favorites-heading" className="tint-ink text-lg font-semibold tracking-tight">
                Favorites
              </h2>
              {/* The one place that says out loud where the heart lives and
                  what it buys — favorites feed the banner and the accent. */}
              <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No favorites yet. Open any show and hit{" "}
                <span className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 align-middle text-xs text-foreground">
                  <HeartIcon aria-hidden className="size-3" />
                  Favorite
                </span>{" "}
                — they headline this page, and they&apos;re where your banner and accent color
                come from.
              </p>
            </section>
          )
        )}

        {total === 0 && profile.favorites.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Looking for something to watch?{" "}
            <Link href="/seasonal" className="underline underline-offset-4 hover:text-primary">
              Browse this season
            </Link>
            .
          </p>
        )}
      </PageShell>
    </div>
  );
}

const STATUS_ORDER = ["watching", "completed", "planning", "paused", "dropped"] as const;

// Module-level so CountUp's ref trick has something stable to hold.
const integer = (n: number) => String(Math.round(n));
const oneDecimal = (n: number) => n.toFixed(1);
// Mid-count the minute total is fractional; formatWatchTime floors everything
// it prints, so the ticker reads "0m → 3h 12m → 9d 11h" without ever lying.
const formatWatchTimeFrame = (minutes: number) => formatWatchTime(Math.round(minutes)) ?? "0h";

function StatTile({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
}) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tint-ink font-mono text-xl font-bold tabular-nums">
        {value == null ? "—" : <CountUp value={value} format={format} />}
      </dd>
    </div>
  );
}
