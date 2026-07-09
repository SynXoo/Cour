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
 * Post-register onboarding shell. Fetches the current-season chart (public,
 * cached) and hands the most popular titles to the picker island; the actual
 * list writes and the skippable flow live client-side in <Onboarding>.
 */
export default async function WelcomePage() {
  const { season, year } = currentSeason();
  const api = serverApi();
  const seasonRes = await api
    .GET("/seasons/{year}/{season}", { params: { path: { year, season } } })
    .catch(() => null);

  // Most recognizable first, capped — a picker, not the whole chart.
  const seasonal = [...(seasonRes?.data?.data ?? [])]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 60);

  return (
    <PageShell width="browse">
      <Onboarding seasonal={seasonal} />
    </PageShell>
  );
}
