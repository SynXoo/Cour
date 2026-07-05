"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AnimeGrid } from "@/components/anime/anime-grid";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SearchClient() {
  const [input, setInput] = useState("");
  const q = useDebounced(input.trim(), 250);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["search", q],
    queryFn: async () => {
      const res = await browserApi.GET("/anime", { params: { query: { q } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    enabled: q.length >= 2,
    placeholderData: (prev) => prev,
  });

  const results = data?.data ?? [];

  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <Input
          autoFocus
          type="search"
          placeholder="Try 'frieren' — or misspell it, we'll cope"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Search anime by title"
          className="max-w-xl"
        />
      </div>

      {q.length < 2 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Type at least two characters to search the catalog.
        </p>
      ) : isError ? (
        <p className="py-16 text-center text-sm text-destructive">
          Search failed — try again in a moment.
        </p>
      ) : isFetching && results.length === 0 ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <li key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
            </li>
          ))}
        </ul>
      ) : results.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No results for “{q}”.
        </p>
      ) : (
        <div aria-live="polite" className={isFetching ? "opacity-70 transition-opacity" : ""}>
          <AnimeGrid anime={results} />
        </div>
      )}
    </div>
  );
}
