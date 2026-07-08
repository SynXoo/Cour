import type { Metadata } from "next";
import { cookies } from "next/headers";
import { HomeView } from "./home-view";
import { LandingView } from "./landing-view";

// SEO speaks to the visitor — crawlers always get the landing branch.
// `absolute` keeps the layout's "%s · Cour" template off the front door.
export const metadata: Metadata = {
  title: { absolute: "Cour — watch the season together" },
  description:
    "Live episode threads for every show this season, spoiler-safe by your progress. Track what you watch, see what's actually trending, and import your list from MAL or AniList in minutes.",
  openGraph: {
    title: "Cour — watch the season together",
    description:
      "Live episode threads for every show this season, spoiler-safe by your progress.",
    type: "website",
    siteName: "Cour",
  },
  twitter: {
    card: "summary",
    title: "Cour — watch the season together",
    description:
      "Live episode threads for every show this season, spoiler-safe by your progress.",
  },
};

/**
 * The front door branches on the `cour_session` marker cookie (a token-free
 * flag the API sets/clears alongside the auth-scoped refresh cookie):
 * members get their home, visitors get the landing. It's a heuristic — a
 * stale marker renders the authed shell whose islands resolve to anon —
 * and reading cookies makes this route dynamic, but every fetch underneath
 * is revalidate-cached so the per-request render stays cheap.
 */
export default async function HomePage() {
  const cookieStore = await cookies();
  return cookieStore.has("cour_session") ? <HomeView /> : <LandingView />;
}
