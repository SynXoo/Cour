import createClient from "openapi-fetch";
import type { paths, components } from "./schema";

export type AnimeSummary = components["schemas"]["AnimeSummary"];
export type AnimeDetail = components["schemas"]["AnimeDetail"];
export type ScheduleEntry = components["schemas"]["ScheduleEntry"];
export type SeasonChart = components["schemas"]["SeasonChart"];
export type Season = components["schemas"]["Season"];
export type SessionUser = components["schemas"]["UserPrivate"];
export type SessionResponse = components["schemas"]["SessionResponse"];

// ── Access-token store (browser only) ──────────────────────────────────────
// The access token lives in memory — never in localStorage or a readable
// cookie. A page reload restores the session via the httpOnly refresh cookie.

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/**
 * Exchange the httpOnly refresh cookie for a fresh session. Returns the user
 * or null when there is no live session. Concurrent callers share one flight.
 */
let refreshFlight: Promise<SessionUser | null> | null = null;

export function refreshSession(): Promise<SessionUser | null> {
  refreshFlight ??= (async () => {
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "X-Requested-With": "fetch" },
      });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const session = (await res.json()) as SessionResponse;
      setAccessToken(session.access_token);
      return session.user;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshFlight = null;
    }
  })();
  return refreshFlight;
}

// In the browser everything goes through this origin — Next rewrites /api/*
// to the Go API, so cookies are first-party and CORS never applies.
export const browserApi = createClient<paths>({ baseUrl: "/api/v1" });

browserApi.use({
  onRequest({ request }) {
    if (accessToken) {
      request.headers.set("Authorization", `Bearer ${accessToken}`);
    }
    request.headers.set("X-Requested-With", "fetch");
    return request;
  },
  async onResponse({ request, response }) {
    // Access token expired mid-session: refresh once and replay.
    if (
      response.status === 401 &&
      accessToken &&
      !request.url.includes("/auth/")
    ) {
      const user = await refreshSession();
      if (user && accessToken) {
        const retry = new Request(request, {
          headers: new Headers(request.headers),
        });
        retry.headers.set("Authorization", `Bearer ${accessToken}`);
        return fetch(retry);
      }
    }
    return response;
  },
});

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
