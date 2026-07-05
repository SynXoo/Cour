import type { Metadata } from "next";

export const metadata: Metadata = { title: "Trending" };

// Replaced by the discovery slice: recency-weighted trending with time decay.
export default function TrendingPage() {
  return (
    <section className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Trending Now</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Cour&apos;s trending ranks what people are actually watching and talking
        about <em>right now</em> — recent activity with time decay, not all-time
        popularity. It switches on with the discovery release.
      </p>
    </section>
  );
}
