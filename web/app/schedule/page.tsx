import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { OpenParties } from "@/components/parties/open-parties";
import { serverApi } from "@/lib/api/client";
import { ScheduleView } from "./schedule-view";

export const metadata: Metadata = {
  title: "This week",
  description:
    "What's airing this week, one day at a time — your shows first, with a discussion room for every episode.",
};

/**
 * The schedule (§M0.5, rebuilt in §M3.8): a day strip and a lens instead of
 * a seven-day wall. The server fetches the week; the client picks the day
 * and trims it to the shows a person could plausibly care about.
 */
export default async function SchedulePage() {
  const res = await serverApi().GET("/schedule", {}).catch(() => null);
  const entries = res?.data?.data ?? [];

  return (
    <PageShell width="browse" className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">This week</h1>
        <p className="text-sm text-muted-foreground">
          One day at a time, your shows first. Times are your local time.
        </p>
      </header>

      {/* Rooms watching together right now; an invitation when none are open. */}
      <OpenParties heading="Watching together tonight" whenEmpty="invite" />

      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-16 text-center text-muted-foreground">
          No schedule synced yet — run <code className="rounded bg-muted px-1.5 py-0.5">task seed</code> or wait for the airing sync.
        </p>
      ) : (
        <ScheduleView entries={entries} />
      )}
    </PageShell>
  );
}
