"use client";

import { XIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { browserApi } from "@/lib/api/client";
import { animeHref, displayTitle, formatLabel } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";
import {
  libraryTotal,
  nextListPage,
  STATUS_TABS,
  type LibraryFilter,
  type LibrarySort,
  type ListEntryWithAnime,
  type ListStatus,
  type ProfileStats,
  type UserList,
} from "@/lib/profile";
import { useState } from "react";

const SORT_LABELS: Record<LibrarySort, string> = {
  updated: "Recently updated",
  score: "Score",
  title: "Title",
};

/** Any stat-driven narrowing is on — the status tabs are not a "filter". */
function hasFilters(filter: LibraryFilter): boolean {
  return (
    filter.score != null ||
    filter.genre != null ||
    filter.year != null ||
    filter.format != null
  );
}

/**
 * The quick-browse ask: the five status counts as real tabs over a dense
 * public poster wall, plus the filters the stats above set (exact score,
 * genre) rendered as removable chips. Pages of 50 via "Show more".
 */
export function LibrarySection({
  ref,
  username,
  counts,
  filter,
  onFilterChange,
}: {
  ref?: Ref<HTMLElement>;
  username: string;
  counts: ProfileStats["counts"];
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
}) {
  const { user } = useSession();
  const isOwner = user?.username === username;
  const total = libraryTotal(counts);
  const [sort, setSort] = useState<LibrarySort>("updated");

  const query = useInfiniteQuery({
    queryKey: [
      "public-list",
      username,
      filter.status,
      filter.score,
      filter.genre,
      filter.year,
      filter.format,
      sort,
    ],
    enabled: total > 0,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<UserList> => {
      const res = await browserApi.GET("/users/{username}/list", {
        params: {
          path: { username },
          query: {
            status: filter.status === "all" ? undefined : filter.status,
            score: filter.score ?? undefined,
            genre: filter.genre ?? undefined,
            year: filter.year ?? undefined,
            format: filter.format ?? undefined,
            sort,
            page: pageParam,
            per_page: 50,
          },
        },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    getNextPageParam: (last) => nextListPage(last),
  });

  const entries = query.data?.pages.flatMap((p) => p.data) ?? [];
  const matchTotal = query.data?.pages[0]?.total ?? 0;

  return (
    <section ref={ref} aria-labelledby="library-heading" className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="library-heading" className="tint-ink text-lg font-semibold tracking-tight">
          Library
        </h2>
        {isOwner && total > 0 && (
          <Link
            href="/list"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-primary"
          >
            Manage on My list →
          </Link>
        )}
      </div>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {isOwner ? (
              <>
                Nothing logged yet — your shelves fill in from the{" "}
                <Link href="/seasonal" className="underline underline-offset-4 hover:text-foreground">
                  seasonal chart
                </Link>{" "}
                or an{" "}
                <Link href="/settings/import" className="underline underline-offset-4 hover:text-foreground">
                  import
                </Link>
                .
              </>
            ) : (
              <>@{username} hasn&apos;t logged any shows yet — their season is still ahead of them.</>
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={filter.status}
              onValueChange={(v) => onFilterChange({ ...filter, status: v as ListStatus | "all" })}
              className="tint-tabs min-w-0"
            >
              {/* The list's height comes from a data-horizontal variant, so a
                  bare h-auto loses — override inside the same variant. */}
              <TabsList className="w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto sm:w-auto">
                <TabsTrigger value="all" className="h-9 md:h-6">
                  All <TabCount value={total} />
                </TabsTrigger>
                {STATUS_TABS.map((s) => (
                  <TabsTrigger key={s.value} value={s.value} className="h-9 md:h-6">
                    {s.label} <TabCount value={counts[s.value]} />
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="ms-auto">
              <Select value={sort} onValueChange={(v) => setSort(v as LibrarySort)}>
                <SelectTrigger size="sm" aria-label="Sort library">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {(Object.keys(SORT_LABELS) as LibrarySort[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SORT_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasFilters(filter) && (
            <div className="flex flex-wrap items-center gap-2">
              {filter.score != null && (
                <FilterChip
                  label={`Scored ${filter.score}`}
                  onClear={() => onFilterChange({ ...filter, score: null })}
                />
              )}
              {filter.genre != null && (
                <FilterChip
                  label={filter.genre}
                  onClear={() => onFilterChange({ ...filter, genre: null })}
                />
              )}
              {filter.year != null && (
                <FilterChip
                  label={`Premiered ${filter.year}`}
                  onClear={() => onFilterChange({ ...filter, year: null })}
                />
              )}
              {filter.format != null && (
                <FilterChip
                  label={formatLabel(filter.format) ?? filter.format}
                  onClear={() => onFilterChange({ ...filter, format: null })}
                />
              )}
            </div>
          )}

          {query.isPending ? (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i}>
                  <Skeleton className="aspect-[2/3] rounded-lg" />
                </li>
              ))}
            </ul>
          ) : query.isError ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load the library — try again in a moment.
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
              Nothing here
              {hasFilters(filter)
                ? " matches the filter"
                : filter.status === "all"
                  ? ""
                  : ` in ${filter.status}`}
              .
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                {entries.map((entry) => (
                  <WallCard key={entry.anime_id} entry={entry} />
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs text-muted-foreground">
                  {entries.length} of {matchTotal}
                </p>
                {query.hasNextPage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 md:h-8"
                    disabled={query.isFetchingNextPage}
                    onClick={() => query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage ? "Loading…" : "Show more"}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function TabCount({ value }: { value: number }) {
  return <span className="ms-1 font-mono text-xs tabular-nums opacity-70">{value}</span>;
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="tint-ink inline-flex h-11 items-center gap-1 rounded-full border border-border/60 bg-card px-3 text-xs font-medium hover:bg-muted md:h-7"
    >
      {label}
      <XIcon aria-hidden className="size-3" />
      <span className="sr-only">— clear filter</span>
    </button>
  );
}

/** Dense wall poster: cover, a mono status chip, a two-line title. */
function WallCard({ entry }: { entry: ListEntryWithAnime }) {
  const a = entry.anime;
  const chip =
    entry.score != null
      ? `★ ${entry.score}`
      : entry.progress > 0
        ? `Ep ${entry.progress}${a.episodes_count ? `/${a.episodes_count}` : ""}`
        : null;

  return (
    <li>
      <Link
        href={animeHref(a)}
        className="group block space-y-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border/60 bg-muted"
          style={a.cover_color ? { backgroundColor: a.cover_color } : undefined}
        >
          {a.cover_image ? (
            <Image
              src={a.cover_image}
              alt=""
              fill
              sizes="(max-width: 640px) 30vw, (max-width: 1280px) 16vw, 160px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-muted-foreground">
              {displayTitle(a)}
            </div>
          )}
          {chip && (
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-black/0 px-1.5 pb-1 pt-4 font-mono text-[11px] text-white">
              {chip}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-xs leading-snug group-hover:text-primary">
          {displayTitle(a)}
        </p>
      </Link>
    </li>
  );
}
