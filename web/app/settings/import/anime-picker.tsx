"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { displayTitle, formatLabel } from "@/lib/anime";
import { browserApi, type AnimeSummary } from "@/lib/api/client";
import { useDebounced } from "@/lib/hooks/use-debounced";

/**
 * Catalog search dialog for resolving an import row by hand — the same
 * ranked fuzzy `/anime?q=` the search page uses, seeded with the row's
 * source title. Mount per row (`key={row_index}`) so state starts fresh.
 */
export function AnimePicker({
  sourceTitle,
  open,
  onOpenChange,
  onPick,
}: {
  sourceTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (anime: AnimeSummary) => void;
}) {
  const [input, setInput] = useState(sourceTitle);
  const q = useDebounced(input.trim(), 250);

  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    enabled: open && q.length >= 2,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await browserApi.GET("/anime", { params: { query: { q } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  const results = data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle>Find a match</DialogTitle>
          <DialogDescription className="truncate">
            In your export: “{sourceTitle}”
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder="Search the catalog…"
            autoFocus
          />
          <CommandList>
            {q.length < 2 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Type at least two characters.
              </p>
            ) : results.length === 0 ? (
              <CommandEmpty>
                {isFetching ? "Searching…" : `No catalog match for “${q}”.`}
              </CommandEmpty>
            ) : (
              results.map((anime) => (
                <CommandItem
                  key={anime.id}
                  value={String(anime.id)}
                  onSelect={() => {
                    onPick(anime);
                    onOpenChange(false);
                  }}
                >
                  {/* Plain <img>: a 28px thumb gains nothing from the
                      next/image pipeline. */}
                  {anime.cover_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={anime.cover_image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-10 w-7 shrink-0 rounded-xs object-cover"
                      style={
                        anime.cover_color
                          ? { backgroundColor: anime.cover_color }
                          : undefined
                      }
                    />
                  ) : (
                    <span className="h-10 w-7 shrink-0 rounded-xs bg-muted" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{displayTitle(anime)}</span>
                    <span className="block truncate text-muted-foreground">
                      {[formatLabel(anime.format), anime.season_year]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
