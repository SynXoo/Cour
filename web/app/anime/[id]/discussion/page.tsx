import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ThreadView } from "@/components/discussions/thread-view";
import { serverApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { animeHref, displayTitle } from "@/lib/anime";

type Thread = components["schemas"]["Thread"];
type AnimeDetail = components["schemas"]["AnimeDetail"];
type Params = { id: string };

async function fetchBoard(idRaw: string): Promise<{ thread: Thread; anime: AnimeDetail } | null> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const api = serverApi();
  const [threadRes, animeRes] = await Promise.all([
    api.GET("/anime/{id}/threads/series", {
      params: { path: { id } },
      fetch: (input: Request) => fetch(input, { cache: "no-store" }),
    }).catch(() => null),
    api.GET("/anime/{id}", { params: { path: { id } } }).catch(() => null),
  ]);
  if (!threadRes?.data || !animeRes?.data) return null;
  return { thread: threadRes.data, anime: animeRes.data };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const data = await fetchBoard((await params).id);
  if (!data) return {};
  return { title: `${displayTitle(data.anime)} — Discussion` };
}

export default async function SeriesDiscussionPage({ params }: { params: Promise<Params> }) {
  const data = await fetchBoard((await params).id);
  if (!data) notFound();
  const { thread, anime } = data;

  return (
    <div className="flex flex-col gap-6 py-2">
      <header className="flex items-center gap-4">
        <Link
          href={animeHref(anime)}
          className="relative h-20 w-14 shrink-0 overflow-hidden rounded bg-muted"
        >
          {anime.cover_image && (
            <Image src={anime.cover_image} alt="" fill sizes="56px" className="object-cover" />
          )}
        </Link>
        <div>
          <Link href={animeHref(anime)} className="text-sm text-muted-foreground hover:text-primary">
            {displayTitle(anime)}
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Series discussion</h1>
          <p className="text-xs text-muted-foreground">
            Whole-series talk — episode specifics live in the{" "}
            <Link href={`${animeHref(anime)}#episodes-heading`} className="underline underline-offset-4">
              episode threads
            </Link>
            .
          </p>
        </div>
      </header>

      <ThreadView threadId={thread.id} allowTimestamps={false} />
    </div>
  );
}
