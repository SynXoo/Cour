import { ChatsCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";
import { buildRooms, type LiveRoom } from "@/lib/landing";
import { tonightRooms } from "@/lib/threads-hub";
import { TonightRail } from "./tonight-rail";

export const metadata: Metadata = {
  title: "Threads",
  description:
    "Every live episode room on Cour — what's opening tonight and which threads are busiest right now.",
};

// The live layer moves faster than the catalog's 5-minute default: the hub
// should visibly change between two visits in one evening.
const liveFetch = (input: Request) => fetch(input, { next: { revalidate: 60 } });

/**
 * The `/threads` hub (§M3.3) — discussions as a destination, not a detour.
 * Two lists: rooms opening tonight (schedule-anchored, live countdowns) and
 * the busiest rooms right now (trending). The server shell carries both;
 * only the tonight countdowns need a client island.
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
  const busiest = buildRooms(threads, now);

  return (
    <PageShell width="browse" className="space-y-10">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ChatsCircleIcon size={26} weight="fill" className="text-primary" aria-hidden />
          Threads
        </h1>
        <p className="text-sm text-muted-foreground">
          Every room on Cour — what&rsquo;s opening tonight, and what&rsquo;s busiest right now.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Opening tonight</h2>
        {tonight.length > 0 ? (
          <TonightRail rooms={tonight} />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing new airs in the next 24 hours — the busiest rooms below are still going.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Busiest this week</h2>
        {busiest.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {busiest.map((room) => (
              <li key={room.threadId}>
                <RoomCard room={room} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="font-medium">The rooms are quiet.</p>
            <p className="mx-auto mt-1 max-w-sm text-balance text-sm text-muted-foreground">
              No thread has stirred in the last couple of days. Open a show and say the first word.
            </p>
            <Link
              href="/seasonal"
              className="mt-4 inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:h-9"
            >
              Browse the season
            </Link>
          </div>
        )}
      </section>
    </PageShell>
  );
}

/** A busiest-room tile: activity and presence, never a comment body. */
function RoomCard({ room }: { room: LiveRoom }) {
  return (
    <Link
      href={room.href}
      className="flex h-full items-center gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/50"
    >
      <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">
        {room.cover && <Image src={room.cover} alt="" fill sizes="44px" className="object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{room.title}</p>
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {room.label} · {room.commentCount} comment{room.commentCount === 1 ? "" : "s"}
          {room.presence > 0 && <span className="text-primary"> · {room.presence} in there</span>}
        </p>
        <time className="mt-0.5 block font-mono text-xs text-muted-foreground">{room.ago}</time>
      </div>
    </Link>
  );
}
