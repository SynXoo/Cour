"use client";

import { HeartIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/session";
import { useFavoriteState, useToggleFavorite } from "@/lib/hooks/use-list";
import { cn } from "@/lib/utils";

/**
 * A bare heart hid the feature: nobody hunts an unlabelled icon wedged between
 * two labelled controls. The button now says what it does, says it in the past
 * tense once it's done, and wears the accent so the "on" state is legible at a
 * glance rather than by comparing two heart weights.
 */
export function FavoriteButton({ animeId }: { animeId: number }) {
  const { status } = useSession();
  const { data: favorited, isPending } = useFavoriteState(animeId);
  const toggle = useToggleFavorite(animeId);

  if (status !== "authed") return null;
  // enabled:false keeps isPending true forever for anon — the guard above
  // means we only reach this while a real fetch is in flight.
  if (isPending) return <Skeleton className="h-9 w-28" />;

  const isFav = favorited ?? false;
  return (
    <Button
      variant="outline"
      aria-pressed={isFav}
      onClick={() => toggle.mutate(!isFav)}
      className={cn("gap-1.5", isFav && "border-primary/50 text-primary hover:text-primary")}
    >
      <HeartIcon weight={isFav ? "fill" : "regular"} aria-hidden />
      {isFav ? "Favorited" : "Favorite"}
    </Button>
  );
}
