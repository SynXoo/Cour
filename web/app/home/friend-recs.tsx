"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { animeHref, displayTitle } from "@/lib/anime";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

/**
 * "Friends think you'd like" (§M3.9): shows friends sent you that aren't
 * on your list, newest first. Absent when there's nothing — a friend's
 * note is the row's whole point, so it never pads with algorithmic picks.
 */
export function FriendRecs() {
  const { status } = useSession();
  const recs = useQuery({
    queryKey: ["friends", "recs"],
    enabled: status === "authed",
    staleTime: 60_000,
    queryFn: async () => {
      const res = await browserApi.GET("/me/friend-recommendations", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });

  const rows = recs.data ?? [];
  if (status !== "authed" || rows.length === 0) return null;

  return (
    <section aria-labelledby="friend-recs" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="friend-recs" className="text-lg font-semibold tracking-tight">
          Friends think you&apos;d <span className="text-primary">like</span>
        </h2>
        <Link href="/friends" className="text-sm text-muted-foreground hover:text-primary">
          Friends →
        </Link>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {rows.map((rec) => (
          <li
            key={`${rec.from.username}-${rec.anime.id}`}
            className="tint-card w-72 shrink-0 rounded-lg border p-2.5"
            style={rec.anime.cover_color ? ({ "--tint": rec.anime.cover_color } as React.CSSProperties) : undefined}
          >
            <div className="flex items-start gap-3">
              <Link
                href={animeHref(rec.anime)}
                tabIndex={-1}
                aria-hidden
                className="relative h-20 w-14 shrink-0 overflow-hidden rounded bg-muted"
              >
                {rec.anime.cover_image && (
                  <Image src={rec.anime.cover_image} alt="" fill sizes="56px" className="object-cover" />
                )}
              </Link>
              <div className="min-w-0 flex-1 space-y-1">
                <Link href={animeHref(rec.anime)} className="line-clamp-1 text-sm font-medium hover:text-primary">
                  {displayTitle(rec.anime)}
                </Link>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Avatar className="h-4 w-4 text-[8px]">
                    {rec.from.avatar_url && <AvatarImage src={rec.from.avatar_url} alt="" />}
                    <AvatarFallback>{rec.from.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <Link href={`/users/${rec.from.username}`} className="truncate hover:text-primary">
                    @{rec.from.username}
                  </Link>
                </p>
                {rec.note && <p className="line-clamp-2 text-xs text-foreground/85">“{rec.note}”</p>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
