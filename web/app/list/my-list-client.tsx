"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { animeHref, displayTitle, formatLabel } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";
import {
  LIST_STATUSES,
  useMyList,
  useUpsertEntry,
  type ListEntryWithAnime,
  type ListStatus,
} from "@/lib/hooks/use-list";

export function MyListClient() {
  const { status: sessionStatus } = useSession();
  const [tab, setTab] = useState<ListStatus | "all">("watching");

  const filter = tab === "all" ? undefined : tab;
  const { data: entries, isLoading } = useMyList(filter);

  if (sessionStatus === "anon") {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Your list lives here</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Track what you&apos;re watching, score what you&apos;ve finished, and plan the
          next season.
        </p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-2">
      <h1 className="text-2xl font-bold tracking-tight">My list</h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ListStatus | "all")}>
        <TabsList className="w-full flex-wrap justify-start sm:w-auto">
          {LIST_STATUSES.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {sessionStatus === "loading" || isLoading ? (
        <ul className="grid gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-20 rounded-lg" />
            </li>
          ))}
        </ul>
      ) : !entries || entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          Nothing {tab === "all" ? "on your list" : `in ${tab}`} yet — find something on the{" "}
          <Link href="/seasonal" className="underline underline-offset-4 hover:text-foreground">
            seasonal chart
          </Link>
          .
        </p>
      ) : (
        <ul className="grid gap-2">
          {entries.map((entry) => (
            <ListRow key={entry.anime_id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListRow({ entry }: { entry: ListEntryWithAnime }) {
  const upsert = useUpsertEntry(entry.anime_id);
  const a = entry.anime;
  const total = a.episodes_count;
  const canBump =
    entry.status === "watching" && (total == null || entry.progress < total);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-2.5">
      <Link href={animeHref(a)} className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
        {a.cover_image && (
          <Image src={a.cover_image} alt="" fill sizes="48px" className="object-cover" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={animeHref(a)} className="line-clamp-1 text-sm font-medium hover:text-primary">
          {displayTitle(a)}
        </Link>
        <p className="text-xs text-muted-foreground">
          {[formatLabel(a.format), entry.score ? `★${entry.score}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm tabular-nums text-muted-foreground">
          {entry.progress}
          {total ? `/${total}` : ""}
        </span>
        {canBump && (
          <Button
            size="sm"
            variant="outline"
            disabled={upsert.isPending}
            aria-label={`Mark episode ${entry.progress + 1} watched`}
            onClick={() =>
              upsert.mutate({ status: entry.status, progress: entry.progress + 1 })
            }
          >
            +1
          </Button>
        )}
      </div>
    </li>
  );
}
