import type { Metadata } from "next";
import { ScheduleDays } from "@/components/anime/schedule-days";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";
import { ScheduleView } from "./schedule-view";

export const metadata: Metadata = {
  title: "Weekly Schedule",
  description: "What's airing this week, day by day — with a discussion thread for every episode.",
};

export default async function SchedulePage() {
  const res = await serverApi().GET("/schedule", {}).catch(() => null);
  const entries = res?.data?.data ?? [];

  return (
    <PageShell width="browse" className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">This week</h1>
        <p className="text-sm text-muted-foreground">
          Every episode airing in the next 7 days. Times are your local time.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-muted-foreground">
          No schedule synced yet — run <code className="rounded bg-muted px-1.5 py-0.5">task seed</code> or wait for the airing sync.
        </p>
      ) : (
        <ScheduleView entries={entries}>
          <ScheduleDays entries={entries} />
        </ScheduleView>
      )}
    </PageShell>
  );
}
