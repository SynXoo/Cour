import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { EpisodeList } from "@/components/anime/episode-list";
import { FavoriteButton } from "@/components/anime/favorite-button";
import { ListEditor } from "@/components/anime/list-editor";
import { AnimeReviews } from "@/components/reviews/anime-reviews";
import { PageShell } from "@/components/page-shell";
import { serverApi, type AnimeDetail } from "@/lib/api/client";
import { formatLabel, seasonLabel, untilLabel } from "@/lib/anime";

type Params = { id: string; slug?: string[] };

async function fetchDetail(idRaw: string): Promise<AnimeDetail | null> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const res = await serverApi()
    .GET("/anime/{id}", { params: { path: { id } } })
    .catch(() => null);
  return res?.data ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const anime = await fetchDetail((await params).id);
  if (!anime) return {};
  const title = anime.title_english ?? anime.title;
  return {
    title,
    description: anime.description?.slice(0, 160) ?? `${title} on Cour — tracking, reviews, and per-episode discussion.`,
  };
}

export default async function AnimeDetailPage({ params }: { params: Promise<Params> }) {
  const anime = await fetchDetail((await params).id);
  if (!anime) notFound();

  const title = anime.title_english ?? anime.title;
  const meta = [
    formatLabel(anime.format),
    anime.episodes_count ? `${anime.episodes_count} episodes` : null,
    anime.duration_min ? `${anime.duration_min} min` : null,
    anime.status === "RELEASING" ? "Airing" : anime.status === "FINISHED" ? "Finished" : null,
  ].filter(Boolean);

  const mainStudios = anime.studios.filter((s) => s.is_main).map((s) => s.name);
  const topTags = [...anime.tags].sort((a, b) => b.rank - a.rank).slice(0, 12);

  return (
    <PageShell width="browse">
    <article className="-mt-6 flex flex-col gap-6">
      {/* Banner */}
      <div className="relative -mx-4 h-40 overflow-hidden sm:h-56 md:rounded-b-xl">
        {anime.banner_image ? (
          <>
            <Image src={anime.banner_image} alt="" fill priority className="object-cover" sizes="100vw" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          </>
        ) : (
          <div
            className="h-full w-full opacity-30"
            style={anime.cover_color ? { backgroundColor: anime.cover_color } : undefined}
          />
        )}
      </div>

      <header className="flex flex-col gap-5 sm:flex-row">
        <div className="relative -mt-24 h-52 w-36 shrink-0 self-start overflow-hidden rounded-lg border border-border shadow-lg sm:-mt-28 sm:h-60 sm:w-40">
          {anime.cover_image ? (
            <Image src={anime.cover_image} alt={`${title} cover`} fill priority sizes="160px" className="object-cover" />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
            {anime.title_english && anime.title !== title && (
              <p className="text-sm text-muted-foreground">{anime.title}</p>
            )}
            {anime.title_native && <p className="text-sm text-muted-foreground">{anime.title_native}</p>}
          </div>

          <p className="font-mono text-sm text-muted-foreground">
            {meta.join(" · ")}
            {anime.season && anime.season_year && (
              <>
                {meta.length > 0 && " · "}
                <Link
                  href={`/seasonal/${anime.season_year}/${anime.season.toLowerCase()}`}
                  className="underline underline-offset-4 hover:text-primary"
                >
                  {seasonLabel(anime.season)} {anime.season_year}
                </Link>
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {anime.average_score != null && (
              <Badge variant="secondary" className="font-mono text-sm">
                ★ {anime.average_score}%
              </Badge>
            )}
            {anime.genres.map((g) => (
              <Badge key={g} variant="outline">
                {g}
              </Badge>
            ))}
          </div>

          {anime.next_airing_at && anime.next_airing_episode != null && (
            <p className="font-mono text-sm">
              <span className="text-primary">
                Episode {anime.next_airing_episode} {untilLabel(anime.next_airing_at)}
              </span>
            </p>
          )}

          {mainStudios.length > 0 && (
            <p className="text-sm text-muted-foreground">Studio: {mainStudios.join(", ")}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <ListEditor animeId={anime.id} episodesCount={anime.episodes_count} />
            <FavoriteButton animeId={anime.id} />
            <Link
              href={`/anime/${anime.id}/discussion`}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              Discussion
            </Link>
          </div>
        </div>
      </header>

      {anime.description && (
        <section aria-label="Synopsis" className="max-w-3xl">
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {anime.description}
          </p>
        </section>
      )}

      {topTags.length > 0 && (
        <section aria-label="Tags" className="flex flex-wrap gap-1.5">
          {topTags.map((t) => (
            <span key={t.name} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              {t.name}
            </span>
          ))}
        </section>
      )}

      {anime.episodes.length > 0 && (
        <section aria-labelledby="episodes-heading" className="space-y-3">
          <h2 id="episodes-heading" className="text-lg font-semibold tracking-tight">
            Episodes
          </h2>
          <p className="text-xs text-muted-foreground">
            Every episode has its own thread — tap in.
          </p>
          <EpisodeList animeId={anime.id} episodes={anime.episodes} />
        </section>
      )}

      <AnimeReviews animeId={anime.id} />

      <p className="text-xs text-muted-foreground">
        Data from AniList · last synced {new Date(anime.synced_at).toLocaleString()}
      </p>
    </article>
    </PageShell>
  );
}
