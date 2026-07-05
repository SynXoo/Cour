"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { ReviewCard, type Review } from "./review-card";
import { ReviewComposer } from "./review-composer";

export function AnimeReviews({ animeId }: { animeId: number }) {
  const { status } = useSession();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["reviews", animeId, page],
    queryFn: async () => {
      const res = await browserApi.GET("/anime/{id}/reviews", {
        params: { path: { id: animeId }, query: { page } },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  const mine = useQuery({
    queryKey: ["reviews", animeId, "mine"],
    enabled: status === "authed",
    queryFn: async (): Promise<Review | null> => {
      const res = await browserApi.GET("/anime/{id}/reviews/mine", {
        params: { path: { id: animeId } },
      });
      if (res.response.status === 404) return null;
      if (res.error) throw new Error(res.error.error.message);
      return res.data ?? null;
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["reviews", animeId] });
  }

  const reviews = list.data?.data ?? [];

  return (
    <section aria-labelledby="reviews-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reviews-heading" className="text-lg font-semibold tracking-tight">
          Reviews
        </h2>
        <ReviewComposer animeId={animeId} existing={mine.data ?? null} onSaved={refresh} />
      </div>

      {list.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-36 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
      ) : reviews.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No reviews yet — set the tone.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
          <div className="flex items-center justify-center gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
            )}
            {list.data?.page.has_more && (
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                More reviews
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
