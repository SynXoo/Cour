import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";
import { currentSeason } from "@/lib/anime";
import { Onboarding } from "./onboarding";

// A private post-register step, not a landing page — keep it out of the index.
export const metadata: Metadata = {
  title: "Set up your list",
  robots: { index: false, follow: false },
};

/**
 * Post-register onboarding shell. Fetches the current-season chart and the
 * all-time-popular catalog head (both public, cached) so the picker's two
 * browse tabs are instant; free search resolves client-side. The list writes
 * and the skippable flow live client-side in <Onboarding>.
 */
export default async function WelcomePage() {
  const { season, year } = currentSeason();
  const api = serverApi();
  const [seasonRes, popularRes] = await Promise.all([
    api
      .GET("/seasons/{year}/{season}", { params: { path: { year, season } } })
      .catch(() => null),
    // No `q` ⇒ listAnime browses by popularity: the all-time-popular head,
    // the scoped exception to the recency thesis (a list-seeding aid only).
    api.GET("/anime", { params: { query: { per_page: 50 } } }).catch(() => null),
  ]);

  // Most recognizable first, capped — a picker, not the whole chart.
  const seasonal = [...(seasonRes?.data?.data ?? [])]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 60);
  const popular = popularRes?.data?.data ?? [];

  return (
    <PageShell width="browse">
      <Onboarding seasonal={seasonal} popular={popular} />
    </PageShell>
  );
}
