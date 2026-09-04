import { ChatsCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";
import { buildRooms } from "@/lib/landing";
import { hubStats, tonightRooms } from "@/lib/threads-hub";
import { ThreadsHub } from "./threads-hub";

export const metadata: Metadata = {
  title: "Rooms",
  description:
    "Every live episode room on Cour, ranked by heat — what's busiest right now, what opens tonight, and the rooms for the shows on your list.",
};

// The live layer moves faster than the catalog's 5-minute default: the hub
// should visibly change between two visits in one evening.
const liveFetch = (input: Request) => fetch(input, { next: { revalidate: 60 } });

/**
 * The `/threads` hub (§M3.3, rebuilt in §M3.8). The server shell fetches the
 * two public feeds and computes the header numbers; the client hub layers
 * the views, sort, search and the viewer's own list on top.
 */
export default async function ThreadsPage() {
  const api = serverApi();

  const [scheduleRes, threadsRes] = await Promise.all([
    api.GET("/schedule", {}).catch(() => null),
    api
      .GET("/threads/trending", { params: { query: { limit: 20 } }, fetch: liveFetch })
      .catch(() => null),
  ]);

  const schedule = scheduleRes?.data?.data ?? [];
  const threads = threadsRes?.data?.data ?? [];

  const now = new Date();
  const tonight = tonightRooms(schedule, threads, now);
  // Rooms, never quotes — the same editorial rule as the landing/home.
  const hot = buildRooms(threads, now);
  const stats = hubStats(hot);

  return (
    <PageShell width="browse" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ChatsCircleIcon size={26} weight="fill" className="text-primary" aria-hidden />
            Rooms
          </h1>
          <p className="text-sm text-muted-foreground">
            Every episode has one. Here they are ranked by heat — and, once you&rsquo;re signed
            in, the ones for your shows.
          </p>
        </div>
        <dl className="flex gap-5 font-mono text-xs text-muted-foreground">
          <div>
            <dt className="sr-only">Rooms alive</dt>
            <dd>
              <span className="text-base font-semibold text-foreground">{stats.rooms}</span> rooms alive
            </dd>
          </div>
          <div>
            <dt className="sr-only">Comments in 48 hours</dt>
            <dd>
              <span className="text-base font-semibold text-foreground">{stats.recent}</span> comments · 48h
            </dd>
          </div>
          {stats.present > 0 && (
            <div>
              <dt className="sr-only">People in rooms now</dt>
              <dd className="text-live">
                <span className="text-base font-semibold">{stats.present}</span> in rooms now
              </dd>
            </div>
          )}
        </dl>
      </header>

      <ThreadsHub hot={hot} tonight={tonight} />
    </PageShell>
  );
}
