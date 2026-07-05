import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { FollowButton } from "@/components/social/follow-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { serverApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { animeHref, displayTitle } from "@/lib/anime";

type UserProfile = components["schemas"]["UserProfile"];
type Params = { username: string };

async function fetchProfile(username: string): Promise<UserProfile | null> {
  const res = await serverApi()
    .GET("/users/{username}", {
      params: { path: { username } },
      // Profiles change often (list activity); keep SSR fresh-ish.
      fetch: (input: Request) => fetch(input, { next: { revalidate: 60 } }),
    })
    .catch(() => null);
  return res?.data ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username}`,
    description: `${username}'s anime list, stats, and favorites on Cour.`,
  };
}

export default async function ProfilePage({ params }: { params: Promise<Params> }) {
  const { username } = await params;
  const profile = await fetchProfile(username);
  if (!profile) notFound();

  const stats = profile.stats;
  const totalRated = stats.rated_count;
  const maxGenre = Math.max(1, ...stats.genres.map((g) => g.count));
  const statCards = [
    { label: "Watching", value: stats.counts.watching },
    { label: "Completed", value: stats.counts.completed },
    { label: "Planning", value: stats.counts.planning },
    { label: "Episodes", value: stats.episodes_watched },
    {
      label: "Mean score",
      value: stats.mean_score != null ? stats.mean_score.toFixed(1) : "—",
      hint: totalRated > 0 ? `${totalRated} rated` : undefined,
    },
  ];

  return (
    <div className="flex flex-col gap-8 py-2">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar className="h-20 w-20 text-xl">
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
          <AvatarFallback>{profile.username.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-1.5">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            @{profile.username}
            {profile.role !== "user" && <Badge variant="secondary">{profile.role}</Badge>}
          </h1>
          {profile.bio && (
            <p className="max-w-xl whitespace-pre-line font-sans text-sm text-foreground/90">
              {profile.bio}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Member since{" "}
            {new Date(profile.created_at).toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </p>
          <FollowButton username={profile.username} />
          {profile.favorite_genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {profile.favorite_genres.map((g) => (
                <Badge key={g} variant="outline">
                  {g}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </header>

      <section aria-label="Stats" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-lg border border-border/60 bg-card p-3 text-center">
            <p className="text-xl font-bold tabular-nums">{s.value}</p>
            <p className="text-xs text-muted-foreground">
              {s.label}
              {s.hint ? ` · ${s.hint}` : ""}
            </p>
          </div>
        ))}
      </section>

      {stats.genres.length > 0 && (
        <section aria-labelledby="genres-heading" className="space-y-3">
          <h2 id="genres-heading" className="text-lg font-semibold tracking-tight">
            Genre breakdown
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {stats.genres.map((g) => (
              <li key={g.genre} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 truncate text-muted-foreground">{g.genre}</span>
                <span
                  className="h-2 rounded-full bg-primary/70"
                  style={{ width: `${Math.max(4, (g.count / maxGenre) * 100)}%` }}
                  aria-hidden
                />
                <span className="text-xs tabular-nums text-muted-foreground">{g.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.currently_watching.length > 0 && (
        <section aria-labelledby="watching-heading" className="space-y-3">
          <h2 id="watching-heading" className="text-lg font-semibold tracking-tight">
            Currently watching
          </h2>
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {profile.currently_watching.map(({ anime, progress }) => (
              <li key={anime.id} className="w-32 shrink-0">
                <Link href={animeHref(anime)} className="group block space-y-1.5">
                  <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border/60 bg-muted">
                    {anime.cover_image && (
                      <Image
                        src={anime.cover_image}
                        alt=""
                        fill
                        sizes="128px"
                        className="object-cover transition-transform group-hover:scale-105"
                      />
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-4 text-xs text-white">
                      Ep {progress}
                      {anime.episodes_count ? `/${anime.episodes_count}` : ""}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs group-hover:text-primary">{displayTitle(anime)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.favorites.length > 0 && (
        <section aria-labelledby="favorites-heading" className="space-y-3">
          <h2 id="favorites-heading" className="text-lg font-semibold tracking-tight">
            Favorites
          </h2>
          <AnimeGrid anime={profile.favorites} />
        </section>
      )}
    </div>
  );
}
