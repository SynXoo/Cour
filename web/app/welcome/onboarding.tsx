"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { browserApi, type AnimeSummary } from "@/lib/api/client";
import { displayTitle } from "@/lib/anime";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/**
 * Post-register onboarding (§M3.3): one skippable step that seeds the
 * watching list so "Tonight on Cour" isn't empty on first landing. Pick shows
 * from the current-season chart (each tap toggles), then one write adds them
 * all as `watching`. The import CTA is the alternative for people bringing a
 * history from MAL/AniList. Nothing here is required — Skip always leaves.
 */
export function Onboarding({ seasonal }: { seasonal: AnimeSummary[] }) {
  const { status, user } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());

  const seed = useMutation({
    mutationFn: async (ids: number[]) => {
      // A handful of genuine "I'm watching this" writes — the normal per-entry
      // path, not the activity-bypassing bulk import path. Settle all so one
      // failure doesn't strand the rest, then report the real success count.
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
          Pick the shows you&rsquo;re watching this season and your home fills in from here —
          countdowns, live rooms, people watching along. You can change this anytime.
        </p>
        <p className="text-sm text-muted-foreground">
          Already track somewhere?{" "}
          <Link
            href="/settings/import"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            Import from MAL or AniList →
          </Link>
        </p>
      </header>

      {seasonal.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          The season chart is quiet right now — you can browse and add shows anytime.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {seasonal.map((a) => (
            <li key={a.id}>
              <PickTile anime={a} selected={picked.has(a.id)} onToggle={() => toggle(a.id)} />
            </li>
          ))}
        </ul>
      )}

      {/* Sticky action bar — clears the mobile tab bar's 4rem + safe area. */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/70 md:bottom-0">
        <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between gap-4 px-4 py-3">
          <p className="min-w-0 font-mono text-sm text-muted-foreground">
            {count > 0 ? (
              <>
                <span className="text-foreground">{count}</span> picked
              </>
            ) : (
              "Tap the shows you're watching"
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={go} disabled={busy} className="h-11 md:h-9">
              Skip for now
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
        {/* Dim unselected covers slightly once anything is picked? No — keep it
            simple: a check badge marks the chosen ones. */}
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
