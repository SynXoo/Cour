import createClient from "openapi-fetch";
import type { paths, components } from "./schema";

export type AnimeSummary = components["schemas"]["AnimeSummary"];
export type AnimeDetail = components["schemas"]["AnimeDetail"];
export type ScheduleEntry = components["schemas"]["ScheduleEntry"];
export type SeasonChart = components["schemas"]["SeasonChart"];
export type Season = components["schemas"]["Season"];

// In the browser everything goes through this origin — Next rewrites /api/*
// to the Go API, so cookies are first-party and CORS never applies.
export const browserApi = createClient<paths>({ baseUrl: "/api/v1" });

// On the server (RSC/SSR) we skip the rewrite hop and hit the API directly.
export function serverApi() {
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8080";
  return createClient<paths>({
    baseUrl: `${base}/api/v1`,
    // Public catalog data: cache briefly so bursts of SSR traffic don't
    // hammer the API, but stay fresh enough for airing updates.
    fetch: (input) => fetch(input, { next: { revalidate: 300 } }),
  });
}
