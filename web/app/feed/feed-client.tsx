"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { animeHref, displayTitle } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";

type FeedItem = components["schemas"]["FeedItem"];

function sentence(item: FeedItem): string {
  const p = item.payload as Record<string, unknown>;
  switch (item.type) {
    case "list_add":
      return p.status === "planning" ? "plans to watch" : `started ${p.status === "watching" ? "watching" : "tracking"}`;
    case "status_change":
      return `moved to ${p.to ?? "another list"}`;
    case "completed":
      return "finished";
    case "scored":
      return `scored ${p.score}/10`;
    case "favorite":
      return "favorited";
    case "review":
      return "reviewed";
    case "comment":
      return p.kind === "episode" ? "joined an episode thread for" : "commented on";
    default:
      return "did something with";
  }
}

function itemHref(item: FeedItem): string {
  if (item.type === "review" && item.ref_id != null) return `/reviews/${item.ref_id}`;
  return animeHref(item.anime);
}

export function FeedClient() {
  const { status } = useSession();

  const feed = useInfiniteQuery({
    queryKey: ["feed"],
    enabled: status === "authed",
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await browserApi.GET("/me/feed", {
        params: { query: pageParam > 0 ? { cursor: pageParam } : {} },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  if (status === "anon") {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Your feed</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Follow people to see what they&apos;re watching, rating, and arguing about.
        </p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  const items = feed.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="flex flex-col gap-4 py-2">
      <h1 className="text-2xl font-bold tracking-tight">Feed</h1>

      {feed.isLoading || status === "loading" ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          Quiet in here. Follow people from their profiles and their activity
          shows up here.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
                  <Link href={`/users/${item.actor.username}`} className="shrink-0">
                    <Avatar className="h-9 w-9 text-xs">
                      {item.actor.avatar_url && <AvatarImage src={item.actor.avatar_url} alt="" />}
                      <AvatarFallback>{item.actor.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </Link>
                  <p className="min-w-0 flex-1 text-sm">
                    <Link href={`/users/${item.actor.username}`} className="font-medium hover:text-primary">
                      @{item.actor.username}
                    </Link>{" "}
                    <span className="text-muted-foreground">{sentence(item)}</span>{" "}
                    <Link href={itemHref(item)} className="font-medium hover:text-primary">
                      {displayTitle(item.anime)}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                  <Link
                    href={itemHref(item)}
                    className="relative h-14 w-10 shrink-0 overflow-hidden rounded bg-muted"
                  >
                    {item.anime.cover_image && (
                      <Image src={item.anime.cover_image} alt="" fill sizes="40px" className="object-cover" />
                    )}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {feed.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className="self-center"
            >
              {feed.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
