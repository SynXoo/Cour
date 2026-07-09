"use client";

import { ImageSquareIcon } from "@phosphor-icons/react";
import { useMutation, useQueries } from "@tanstack/react-query";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi, type AnimeDetail, type AnimeSummary } from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";
import type { ProfileBanner } from "@/lib/profile";

/**
 * Own-profile banner chooser. Candidates are the owner's favorites that have
 * AniList banner art — no uploads, no moderation surface. AnimeSummary
 * doesn't carry banner urls, so each favorite's detail is fetched lazily the
 * first time the popover opens (`["anime-preview", id]` is shared with the
 * home timeline's preview cache, staleTime ∞ — one request per show ever).
 */
export function BannerPicker({
  favorites,
  current,
  onPicked,
}: {
  favorites: AnimeSummary[];
  current: ProfileBanner | null;
  onPicked: (banner: ProfileBanner | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const details = useQueries({
    queries: favorites.map((f) => ({
      queryKey: ["anime-preview", f.id],
      queryFn: async (): Promise<AnimeDetail> => {
        const res = await browserApi.GET("/anime/{id}", { params: { path: { id: f.id } } });
        if (res.error) throw new Error(res.error.error.message);
        return res.data;
      },
      staleTime: Infinity,
      enabled: open,
    })),
  });
  const loading = open && details.some((d) => d.isPending);
  const candidates = details
    .map((d) => d.data)
    .filter((d): d is AnimeDetail => Boolean(d?.banner_image));

  const pick = useMutation({
    mutationFn: async (animeId: number) => {
      const res = await browserApi.PATCH("/me/profile", {
        body: { banner_anime_id: animeId },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    onSuccess: (_data, animeId) => {
      if (animeId === 0) {
        onPicked(null);
        toast.success("Banner removed");
      } else {
        const detail = candidates.find((c) => c.id === animeId);
        onPicked({
          anime_id: animeId,
          banner_image: detail?.banner_image ?? null,
          cover_color: detail?.cover_color ?? null,
        });
        toast.success("Banner updated");
      }
      setOpen(false);
    },
    onError: (err) => toast.error(err.message || "Something went wrong"),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
          <ImageSquareIcon aria-hidden />
          Choose banner
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="mb-2 text-sm font-medium">Banner from your favorites</p>
        {favorites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Favorite a few shows first — banners come from your favorites&apos; art.
          </p>
        ) : loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None of your favorites have banner art yet.
          </p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick.mutate(c.id)}
                  disabled={pick.isPending}
                  aria-pressed={current?.anime_id === c.id}
                  className="group relative block h-16 w-full overflow-hidden rounded-md border border-border/60 outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary"
                >
                  {c.banner_image && (
                    <Image
                      src={c.banner_image}
                      alt=""
                      fill
                      sizes="320px"
                      className="object-cover transition-transform group-hover:scale-105"
                    />
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-black/0 px-2 pb-1 pt-4 text-left text-xs text-white">
                    {displayTitle(c)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {current && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-11 w-full md:h-8"
            disabled={pick.isPending}
            onClick={() => pick.mutate(0)}
          >
            Remove banner
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
