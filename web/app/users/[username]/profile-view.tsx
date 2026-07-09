"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { PageShell } from "@/components/page-shell";
import {
  formatWatchTime,
  libraryTotal,
  profileTint,
  type LibraryFilter,
  type ProfileBanner,
  type UserProfile,
} from "@/lib/profile";
import { GenreBars } from "./genre-bars";
import { LibrarySection } from "./library-section";
import { ProfileHero } from "./profile-hero";
import { ScoreHistogram } from "./score-histogram";
import { WatchingRail } from "./watching-rail";

/**
 * Client root for the whole profile: the banner pick must repaint the hero
 * and the page accent instantly, and a histogram/genre click must land in
 * the library tabs — one component tree keeps that state in plain props.
 * SSR still renders all of it; only the library pages fetch client-side.
 */
export function ProfileView({ profile }: { profile: UserProfile }) {
  const [banner, setBanner] = useState<ProfileBanner | null>(profile.banner);
  const tint = profileTint(banner, profile.favorites);

  const stats = profile.stats;
  const total = libraryTotal(stats.counts);
  const [filter, setFilter] = useState<LibraryFilter>(() => ({
    status: STATUS_ORDER.find((s) => stats.counts[s] > 0) ?? "watching",
    score: null,
    genre: null,
  }));
  const librarySection = useRef<HTMLElement>(null);

  const jumpToLibrary = (patch: Partial<LibraryFilter>) => {
    // A stat click always widens to "all": the histogram counts every
    // status, so landing on a narrower tab would silently drop matches.
    setFilter((f) => ({ ...f, status: "all", ...patch }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    librarySection.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const watchTime = formatWatchTime(stats.watch_minutes);

  return (
    <div style={tint ? ({ "--tint": tint } as CSSProperties) : undefined}>
      <PageShell width="browse" className="flex flex-col gap-10">
        <ProfileHero
          profile={profile}
          banner={banner}
          onBannerChange={setBanner}
        />

        <section aria-labelledby="stats-heading" className="flex flex-col gap-6">
          <h2 id="stats-heading" className="sr-only">
            Statistics
          </h2>

          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <p className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                {watchTime ? (
                  <>
                    <span aria-hidden>≈ </span>
                    <span className="tint-ink">{watchTime}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">0h</span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {watchTime ? "in front of the screen" : "no episodes logged yet"}
              </p>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <StatTile label="Episodes" value={stats.episodes_watched} />
              <StatTile
                label={stats.rated_count > 0 ? `Mean of ${stats.rated_count} rated` : "Mean score"}
                value={stats.mean_score != null ? stats.mean_score.toFixed(1) : "—"}
              />
              <StatTile label="Shows" value={total} />
            </dl>
          </div>

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

        {profile.favorites.length > 0 && (
          <section aria-labelledby="favorites-heading" className="space-y-3">
            <h2 id="favorites-heading" className="tint-ink text-lg font-semibold tracking-tight">
              Favorites
            </h2>
            <AnimeGrid anime={profile.favorites} />
          </section>
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

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tint-ink font-mono text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
