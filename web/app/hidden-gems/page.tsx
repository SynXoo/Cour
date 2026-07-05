import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hidden Gems" };

// Replaced by the discovery slice: high-rated, low-popularity recent titles.
export default function HiddenGemsPage() {
  return (
    <section className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Hidden Gems</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Recent shows people rate highly but few have found — the deliberate
        inversion of the popularity bias. It switches on with the discovery
        release.
      </p>
    </section>
  );
}
