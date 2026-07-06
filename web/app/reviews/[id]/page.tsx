import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewCard } from "@/components/reviews/review-card";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { animeHref, displayTitle } from "@/lib/anime";

type ReviewDetail = components["schemas"]["ReviewDetail"];
type Params = { id: string };

async function fetchReview(idRaw: string): Promise<ReviewDetail | null> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const res = await serverApi()
    .GET("/reviews/{reviewId}", { params: { path: { reviewId: id } } })
    .catch(() => null);
  return res?.data ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const review = await fetchReview((await params).id);
  if (!review) return {};
  const title = displayTitle(review.anime);
  return {
    title: `${review.author.username}'s review of ${title}`,
    description: review.has_spoilers
      ? `A ${review.score}/10 review of ${title} (contains spoilers).`
      : review.body.slice(0, 160),
  };
}

export default async function ReviewPage({ params }: { params: Promise<Params> }) {
  const review = await fetchReview((await params).id);
  if (!review) notFound();

  const anime = review.anime;
  return (
    <PageShell width="reading" className="flex flex-col gap-6">
      <Link
        href={animeHref(anime)}
        className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3"
      >
        <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
          {anime.cover_image && (
            <Image src={anime.cover_image} alt="" fill sizes="48px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium group-hover:text-primary">{displayTitle(anime)}</p>
          <p className="text-xs text-muted-foreground">Review by @{review.author.username}</p>
        </div>
      </Link>

      <ReviewCard review={review} clampBody={false} />
    </PageShell>
  );
}
