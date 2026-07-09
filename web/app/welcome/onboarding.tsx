"use client";

import { CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi, type AnimeSummary } from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { cn } from "@/lib/utils";

type Tab = "seasonal" | "popular";

/**
 * Post-register onboarding (§M3.3, +M3.3-fu): one skippable step that seeds
 * the watching list so "Tonight on Cour" isn't empty on first landing. Not
 * everyone signs up mid-season, so the picker offers three ways in — the
 * current-season chart, an all-time-popular tab (the scoped exception to the
 * recency thesis: a list-seeding aid, never front-door content), and free
 * search — with one shared selection across all of them. Skip always leaves.
 */
export function Onboarding({
  seasonal,
  popular,
}: {
  seasonal: AnimeSummary[];
  popular: AnimeSummary[];
}) {
  const { status, user } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [tab, setTab] = useState<Tab>("seasonal");
  const [searchInput, setSearchInput] = useState("");
  const q = useDebounced(searchInput.trim(), 250);
  const searching = q.length >= 2;

  const search = useQuery({
    queryKey: ["onboarding-search", q],
    enabled: searching,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await browserApi.GET("/anime", { params: { query: { q } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });

  const seed = useMutation({
    mutationFn: async (ids: number[]) => {
      // A handful of genuine "add this to my list" writes — the normal
      // per-entry path, not the activity-bypassing bulk import path. Settle all
      // so one failure doesn't strand the rest, then report the real count.
      const results = await Promise.allSettled(
        ids.map((animeId) =>
          browserApi
            .PUT("/me/list/{animeId}", {
              params: { path: { animeId } },
              body: { status: "watching" },
            })
            .then((res) => {
              if (res.error) throw new Error(res.error.error.message);
            }),
        ),
      );
      return results.filter((r) => r.status === "fulfilled").length;
    },
    onSuccess: (added) => {
      qc.invalidateQueries({ queryKey: ["list"] });
      if (added > 0) {
        toast.success(`Added ${added} show${added === 1 ? "" : "s"} to your list — welcome aboard.`);
      }
      go();
    },
    onError: () => {
      toast.error("Couldn't save your picks — you can add shows anytime from a show's page.");
      go();
    },
  });

  function go() {
    router.push("/");
    router.refresh();
  }

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const count = picked.size;
  const finish = () => (count > 0 ? seed.mutate([...picked]) : go());

  // Stale marker / hard reload before the session rehydrated: send them back
  // to sign in rather than let the picks silently fail to save.
  if (status === "anon") {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <p className="font-medium">You&rsquo;re signed out.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to set up your list — it only takes a moment.
        </p>
        <Button asChild className="mt-4">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  const busy = seed.isPending;
  const browseList = tab === "seasonal" ? seasonal : popular;
  const items = searching ? (search.data ?? []) : browseList;

  return (
    <div className="space-y-6 pb-28">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {status === "authed" && user ? (
            <>
              You&rsquo;re in, <span className="text-primary">@{user.username}</span>.
            </>
          ) : (
            "Welcome to Cour."
          )}
        </h1>
        <p className="max-w-prose text-muted-foreground">
          Add the shows you&rsquo;re watching — or classics you want to jump back into — and your
          home fills in with countdowns, live rooms, and the conversation. You can change this
          anytime.
        </p>
        <p className="text-sm text-muted-foreground">
          Bringing a history?{" "}
          <Link
            href="/settings/import"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            Import from MAL or AniList →
          </Link>
        </p>
      </header>

      {/* Browse controls: which pool to show, or search across the whole
          catalog. Selection is shared, so picks survive tab/search changes. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-border/60 p-0.5" role="group" aria-label="Browse shows">
          <TabButton active={!searching && tab === "seasonal"} onClick={() => setTab("seasonal")}>
            Airing now
          </TabButton>
          <TabButton active={!searching && tab === "popular"} onClick={() => setTab("popular")}>
            All-time popular
          </TabButton>
        </div>
        <div className="relative sm:w-72">
          <MagnifyingGlassIcon
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search any show by title…"
            aria-label="Search the catalog to add a show"
            className="h-11 pl-9 md:h-9"
          />
        </div>
      </div>

      <PickerGrid
        items={items}
        picked={picked}
        onToggle={toggle}
        searching={searching}
        loading={searching && search.isFetching && (search.data?.length ?? 0) === 0}
        query={q}
      />

      {/* Sticky action bar — clears the mobile tab bar's 4rem + safe area. */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/70 md:bottom-0">
        <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-4 px-4 py-3">
          <p className="min-w-0 font-mono text-sm text-muted-foreground">
            {count > 0 ? (
              <>
                <span className="text-foreground">{count}</span> picked
              </>
            ) : (
              "Tap shows to add them"
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={go} disabled={busy} className="h-11 md:h-9">
              {count > 0 ? "Skip for now" : "Not watching anything yet"}
            </Button>
            <Button onClick={finish} disabled={busy || count === 0} className="h-11 px-5 md:h-9">
              {busy ? "Adding…" : count > 0 ? `Add ${count} & finish` : "Add shows"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PickerGrid({
  items,
  picked,
  onToggle,
  searching,
  loading,
  query,
}: {
  items: AnimeSummary[];
  picked: ReadonlySet<number>;
  onToggle: (id: number) => void;
  searching: boolean;
  loading: boolean;
  query: string;
}) {
  if (loading) {
    return (
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <li key={i} className="space-y-1.5">
            <Skeleton className="aspect-[2/3] rounded-lg" />
            <Skeleton className="h-3 w-3/4" />
          </li>
        ))}
      </ul>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {searching
          ? `No results for “${query}”.`
          : "Nothing to show here yet — try search, or skip for now."}
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {items.map((a) => (
        <li key={a.id}>
          <PickTile anime={a} selected={picked.has(a.id)} onToggle={() => onToggle(a.id)} />
        </li>
      ))}
    </ul>
  );
}

function PickTile({
  anime,
  selected,
  onToggle,
}: {
  anime: AnimeSummary;
  selected: boolean;
  onToggle: () => void;
}) {
  const title = displayTitle(anime);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className="group flex w-full flex-col gap-1.5 text-left outline-none"
    >
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-lg border bg-muted transition-all group-focus-visible:ring-2 group-focus-visible:ring-ring",
          selected ? "border-primary ring-2 ring-primary" : "border-border/60 hover:border-primary/50",
        )}
        style={anime.cover_color && !anime.cover_image ? { backgroundColor: anime.cover_color } : undefined}
      >
        {anime.cover_image ? (
          <Image
            src={anime.cover_image}
            alt=""
            fill
            sizes="(max-width: 640px) 30vw, 160px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {title}
          </div>
        )}
        <span
          className={cn(
            "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border transition-all",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-white/70 bg-black/30 text-transparent group-hover:text-white/80",
          )}
          aria-hidden
        >
          <CheckIcon size={14} weight="bold" />
        </span>
      </div>
      <p
        className={cn(
          "line-clamp-2 text-xs leading-snug",
          selected ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {title}
      </p>
    </button>
  );
}
