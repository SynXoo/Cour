"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMyListEntry, useUpsertEntry } from "@/lib/hooks/use-list";
import { useSession } from "@/lib/auth/session";
import { EpisodeAiringContext, SpoilerShieldContext } from "./comment-item";

/**
 * The progress-aware spoiler guard (§M2 spec). Cour knows the viewer is on
 * episode P; on an aired episode-N thread with P < N it says so and blurs
 * every comment (bodies via SpoilerGuard, reply quote chips and the composer
 * reply chip via SpoilerShieldContext) until the viewer opts out — or simply
 * marks the episode watched, which is the whole point of the loop.
 *
 * Client-side against the already-loaded list entry; anonymous viewers and
 * titles not on the list get no guard (there is no progress to guard with).
 * Also provides the episode's airing time for the night-of comment badge.
 */
export function EpisodeSpoilerShield({
  animeId,
  episodeNumber,
  airingAt,
  aired,
  children,
}: {
  animeId: number;
  episodeNumber: number;
  airingAt: string | null;
  /** Computed server-side (react-hooks/purity bars Date.now() in render). */
  aired: boolean;
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const { data: entry, isPending } = useMyListEntry(animeId);
  const upsert = useUpsertEntry(animeId);
  const [revealed, setRevealed] = useState(false);

  // Completed = seen everything, whatever the progress column says.
  const behind =
    aired && entry != null && entry.status !== "completed" && entry.progress < episodeNumber;
  // Blur while the entry is still loading too: a brief blur→reveal for the
  // caught-up is better than a spoiler flash for the behind.
  const shield = status === "authed" && (isPending ? true : behind && !revealed);
  const isNext = entry != null && entry.progress === episodeNumber - 1;

  return (
    <EpisodeAiringContext.Provider value={airingAt}>
      <SpoilerShieldContext.Provider value={shield}>
        {behind && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm">
            {/* basis-full drops the buttons to their own row below md. */}
            <p className="min-w-0 flex-1 basis-full md:basis-0">
              {isNext ? (
                <>You haven&apos;t watched this episode yet — comments are blurred.</>
              ) : (
                <>
                  You&apos;re {episodeNumber - entry.progress} episodes behind (on episode{" "}
                  {entry.progress}) — comments are blurred.
                </>
              )}
            </p>
            <span className="flex shrink-0 gap-1.5">
              {isNext && (
                <Button
                  size="sm"
                  className="h-11 md:h-7"
                  disabled={upsert.isPending}
                  onClick={() =>
                    // QoL transitions server-side: final episode → completed,
                    // first watch stamps started_on.
                    upsert.mutate({ status: "watching", progress: episodeNumber })
                  }
                >
                  Mark ep {episodeNumber} watched
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-11 md:h-7"
                aria-pressed={revealed}
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? "Blur again" : "Show anyway"}
              </Button>
            </span>
          </div>
        )}
        {children}
      </SpoilerShieldContext.Provider>
    </EpisodeAiringContext.Provider>
  );
}
