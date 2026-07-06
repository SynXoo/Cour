"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ScheduleDays } from "@/components/anime/schedule-days";
import { Switch } from "@/components/ui/switch";
import type { ScheduleEntry } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useMyList } from "@/lib/hooks/use-list";

/**
 * Wraps the schedule with a "my shows only" toggle. The default (all) view is
 * the server-rendered `children` — passed through untouched so its markup and
 * airing times stay prerendered. Filtering is a client-side join against the
 * viewer's list; the toggle only appears once signed in.
 */
export function ScheduleView({
  entries,
  children,
}: {
  entries: ScheduleEntry[];
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const { data: list } = useMyList();
  const [myOnly, setMyOnly] = useState(false);
  const switchId = useId();

  const myIds = useMemo(() => new Set((list ?? []).map((e) => e.anime_id)), [list]);
  const mine = useMemo(() => entries.filter((e) => myIds.has(e.anime.id)), [entries, myIds]);

  const showToggle = status === "authed";
  const filtered = myOnly && showToggle;

  return (
    <div className="flex flex-col gap-8">
      {showToggle && (
        <label
          htmlFor={switchId}
          className="flex select-none items-center gap-2 self-start text-sm font-medium"
        >
          <Switch id={switchId} checked={myOnly} onCheckedChange={setMyOnly} />
          My shows only
        </label>
      )}

      {filtered ? (
        mine.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
            None of the shows on your list air in the next 7 days — find more on the{" "}
            <Link href="/seasonal" className="underline underline-offset-4 hover:text-foreground">
              seasonal chart
            </Link>
            .
          </p>
        ) : (
          <ScheduleDays entries={mine} />
        )
      ) : (
        children
      )}
    </div>
  );
}
