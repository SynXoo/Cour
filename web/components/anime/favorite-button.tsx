"use client";

import { HeartIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/session";
import { useFavoriteState, useToggleFavorite } from "@/lib/hooks/use-list";

export function FavoriteButton({ animeId }: { animeId: number }) {
  const { status } = useSession();
  const { data: favorited } = useFavoriteState(animeId);
  const toggle = useToggleFavorite(animeId);

  if (status !== "authed") return null;

  const isFav = favorited ?? false;
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFav}
      onClick={() => toggle.mutate(!isFav)}
    >
      <HeartIcon weight={isFav ? "fill" : "regular"} className={isFav ? "text-primary" : ""} />
    </Button>
  );
}
