import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EpisodeSpoilerShield } from "@/components/discussions/episode-spoiler-shield";
import { ThreadView } from "@/components/discussions/thread-view";
import { PageShell } from "@/components/page-shell";
import { PartyLauncher } from "@/components/parties/party-launcher";
import { serverApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { airDateLabel, animeHref, displayTitle, isUpcoming, untilLabel } from "@/lib/anime";
import { withinLiveWindow } from "@/lib/thread-texture";

type EpisodeThread = components["schemas"]["EpisodeThread"];
type Params = { id: string; n: string };

async function fetchThread(idRaw: string, nRaw: string): Promise<EpisodeThread | null> {
  const id = Number(idRaw);
  const n = Number(nRaw);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n <= 0) return null;
  const res = await serverApi()
    .GET("/anime/{id}/episodes/{number}/thread", {
      params: { path: { id, number: n } },
      // Threads move fast; don't cache the SSR fetch.
      fetch: (input: Request) => fetch(input, { cache: "no-store" }),
    })
    .catch(() => null);
  return res?.data ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const data = await fetchThread(p.id, p.n);
  if (!data) return {};
  const title = displayTitle(data.anime);
  return {
    title: `${title} — Episode ${data.episode.number} discussion`,
    description: `Talk about episode ${data.episode.number} of ${title} — timestamped comments, reactions, no stream links.`,
  };
}

export default async function EpisodeThreadPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const data = await fetchThread(p.id, p.n);
  if (!data) notFound();

  const { anime, episode, thread } = data;
  const upcoming = isUpcoming(episode.airing_at);
  // The ritual window (M3.4): aired within ~24 h — the header marks the room
  // as LIVE and the thread vitals show velocity. Server clock; the page is
  // uncached (no-store fetch above), so it's current per request.
  const live = withinLiveWindow(episode.airing_at);
  const prev = episode.number > 1 ? episode.number - 1 : null;
  const next =
    anime.episodes_count == null || episode.number < anime.episodes_count
      ? episode.number + 1
      : null;

  return (
    <PageShell width="reading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Link
            href={animeHref(anime)}
            className="relative h-20 w-14 shrink-0 overflow-hidden rounded bg-muted"
          >
            {anime.cover_image && (
              <Image src={anime.cover_image} alt="" fill sizes="56px" className="object-cover" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={animeHref(anime)} className="text-sm text-muted-foreground hover:text-primary">
              {displayTitle(anime)}
            </Link>
            <h1 className="text-xl font-bold tracking-tight">
              Episode {episode.number}
              {episode.title ? ` — ${episode.title}` : ""}
            </h1>
            {episode.airing_at && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
                {live && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-live/40 bg-live/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-live">
                    <span className="relative flex h-1.5 w-1.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
                    </span>
                    LIVE
                  </span>
                )}
                <span>
                  {upcoming
                    ? `Airs ${untilLabel(episode.airing_at)} · ${airDateLabel(episode.airing_at)}`
                    : `Aired ${airDateLabel(episode.airing_at)}`}
                </span>
              </p>
            )}
          </div>
        </div>
        {/* Nav drops to its own full-width row on mobile so the title never
            fights the prev/next buttons for horizontal space (M0.4). */}
        <nav aria-label="Episode navigation" className="flex gap-1.5 text-sm md:shrink-0">
          {prev && (
            <Link
              href={`/anime/${anime.id}/episode/${prev}`}
              className="flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground md:min-h-0 md:px-2.5 md:py-1.5"
            >
              ← {prev}
            </Link>
          )}
          {next && (
            <Link
              href={`/anime/${anime.id}/episode/${next}`}
              className="flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground md:min-h-0 md:px-2.5 md:py-1.5"
            >
              {next} →
            </Link>
          )}
        </nav>
      </header>

      {upcoming && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
          This episode hasn&apos;t aired yet — the thread is open for
          speculation. Tag spoilers from source material!
        </p>
      )}

      {/* Watch parties (M4): open rooms for this episode + "Start a party".
          Renders nothing while the feature flag is off. */}
      {!upcoming && <PartyLauncher animeId={anime.id} episode={episode.number} />}

      <EpisodeSpoilerShield
        animeId={anime.id}
        episodeNumber={episode.number}
        airingAt={episode.airing_at ?? null}
        // Null airing_at still guards: a finished show without per-episode
        // dates is aired; only a *known upcoming* episode skips (the
        // speculation banner owns those).
        aired={!upcoming}
      >
        <ThreadView
          threadId={thread.id}
          allowTimestamps
          airingAt={episode.airing_at ?? null}
          upcoming={upcoming}
          live={live}
        />
      </EpisodeSpoilerShield>

      <p className="text-xs text-muted-foreground">
        {thread.comment_count} comment{thread.comment_count === 1 ? "" : "s"} ·
        anchor a comment to a moment with a timestamp like 12:34 · bring your
        own legal stream.
      </p>
    </PageShell>
  );
}
