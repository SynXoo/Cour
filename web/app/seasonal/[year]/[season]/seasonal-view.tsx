"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnimeSummary } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  arrangeAnime,
  collectGenres,
  collectWeekdays,
  DEFAULT_SORT,
  FORMAT_GROUPS,
  filterAnime,
  hasActiveFilters,
  isGroupedView,
  parseFormatGroup,
  parseSort,
  parseWeekday,
  SEASONAL_SORTS,
  type SeasonalFilters,
  WEEKDAY_LABELS,
} from "@/lib/seasonal";

/**
 * Client-side sort + filter over a fully-loaded season (a season is only a few
 * hundred titles, so everything is instant and never re-fetches). State lives
 * in the URL (`?sort=score&genre=Action&day=friday`) so a filtered view is
 * shareable. The default view keeps the TV / Movies / Specials grouping; any
 * non-default sort or active filter flattens to a single grid.
 */
export function SeasonalView({ anime }: { anime: AnimeSummary[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const sort = parseSort(params.get("sort"));
  const filters = useMemo<SeasonalFilters>(
    () => ({
      format: parseFormatGroup(params.get("format")),
      genre: params.get("genre"),
      day: parseWeekday(params.get("day")),
    }),
    [params],
  );

  const genres = useMemo(() => collectGenres(anime), [anime]);
  const weekdays = useMemo(() => collectWeekdays(anime), [anime]);
  const grouped = isGroupedView(sort, filters);
  const arranged = useMemo(() => arrangeAnime(anime, sort, filters), [anime, sort, filters]);

  // Build the next URL from a set of param mutations. Defaults (popularity
  // sort, no filter) are dropped so shared links stay clean.
  function commit(next: Partial<Record<"sort" | "format" | "genre" | "day", string | null>>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "" || (key === "sort" && value === DEFAULT_SORT)) {
        sp.delete(key);
      } else {
        sp.set(key, value);
      }
    }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Toggle a single-value filter: clicking the active chip clears it.
  const toggle = (key: "format" | "genre" | "day", value: string, active: boolean) =>
    commit({ [key]: active ? null : value });

  const anyActive = sort !== DEFAULT_SORT || hasActiveFilters(filters);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">Sort</span>
            <Select value={sort} onValueChange={(v) => commit({ sort: v })}>
              <SelectTrigger size="sm" aria-label="Sort titles" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEASONAL_SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            {arranged.length} {arranged.length === 1 ? "title" : "titles"}
          </span>

          {anyActive && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => router.replace(pathname, { scroll: false })}
            >
              Clear
            </Button>
          )}
        </div>

        <ChipRow label="Format">
          {FORMAT_GROUPS.map((g) => (
            <Chip
              key={g.id}
              active={filters.format === g.id}
              onClick={() => toggle("format", g.id, filters.format === g.id)}
            >
              {g.label}
            </Chip>
          ))}
        </ChipRow>

        {weekdays.length > 0 && (
          <ChipRow label="Airing day">
            {weekdays.map((w) => (
              <Chip
                key={w}
                active={filters.day === w}
                onClick={() => toggle("day", w, filters.day === w)}
              >
                {WEEKDAY_LABELS[w]}
              </Chip>
            ))}
          </ChipRow>
        )}

        {genres.length > 0 && (
          <ChipRow label="Genre">
            {genres.map((g) => (
              <Chip
                key={g}
                active={filters.genre === g}
                onClick={() => toggle("genre", g, filters.genre === g)}
              >
                {g}
              </Chip>
            ))}
          </ChipRow>
        )}
      </div>

      {grouped ? (
        <GroupedGrid anime={anime} />
      ) : arranged.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          No titles match these filters.
        </p>
      ) : (
        <AnimeGrid anime={arranged} priorityCount={6} />
      )}
    </div>
  );
}

function GroupedGrid({ anime }: { anime: AnimeSummary[] }) {
  const groups = FORMAT_GROUPS.map((g) => ({
    label: g.label,
    anime: filterAnime(anime, { format: g.id, genre: null, day: null }),
  })).filter((g) => g.anime.length > 0);

  // Popularity order within each group, matching the default flat sort.
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{g.label}</h2>
          <AnimeGrid
            anime={arrangeAnime(g.anime, DEFAULT_SORT, {
              format: null,
              genre: null,
              day: null,
            })}
            priorityCount={g.label === "TV" ? 6 : 0}
          />
        </section>
      ))}
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
      className={cn(!active && "text-muted-foreground")}
    >
      {children}
    </Button>
  );
}
