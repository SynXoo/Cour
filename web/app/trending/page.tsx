import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { TRENDING_WINDOW_DAYS } from "@/lib/trending";
import { TrendingClient } from "./trending-client";

export const metadata: Metadata = {
  title: "Trending Now",
  description:
    "The dozen shows Cour is actually talking about right now — and why each one is there, in numbers.",
};

/**
 * Trending (§M3.8): a short, argued list instead of a 60-poster wall. The
 * ranking is public, but the "why for you" half needs the viewer's token,
 * so the list is a client island; the shell is static.
 */
export default function TrendingPage() {
  return (
    <PageShell width="browse" className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Trending Now</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Twelve shows, ranked by what Cour members did in the last {TRENDING_WINDOW_DAYS}{" "}days —
          reviews, favorites, comments, finishes, list adds — with recent activity worth more.
          Each one says why it&apos;s here, and what it has to do with you.
        </p>
      </header>
      <TrendingClient />
    </PageShell>
  );
}
