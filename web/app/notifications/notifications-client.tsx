"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { describeNotification } from "@/lib/notifications";

export function NotificationsClient() {
  const { status } = useSession();
  const qc = useQueryClient();

  const list = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    enabled: status === "authed",
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await browserApi.GET("/me/notifications", {
        params: { query: pageParam > 0 ? { cursor: pageParam } : {} },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const markAll = useMutation({
    mutationFn: async () => {
      await browserApi.POST("/me/notifications/read", { body: { all: true } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Opening one clears its dot, same as from the bell panel.
  const markOne = useMutation({
    mutationFn: async (id: number) => {
      // keepalive: the click navigates away, which would abort a plain fetch.
      await browserApi.POST("/me/notifications/read", {
        body: { ids: [id], all: false },
        keepalive: true,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (status === "anon") {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  const anyUnread = items.some((n) => !n.read);

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        {anyUnread && (
          <Button variant="outline" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            Mark all read
          </Button>
        )}
      </div>

      {list.isLoading || status === "loading" ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          Nothing yet — replies, new followers, and fresh episodes land here.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {items.map((n) => {
              const { text, href } = describeNotification(n);
              return (
                <li key={n.id}>
                  <Link
                    href={href}
                    onClick={() => {
                      if (!n.read) markOne.mutate(n.id);
                    }}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50 ${
                      n.read ? "border-border/40 opacity-70" : "border-border/80 bg-card"
                    }`}
                  >
                    {n.actor ? (
                      <Avatar className="h-8 w-8 text-xs">
                        {n.actor.avatar_url && <AvatarImage src={n.actor.avatar_url} alt="" />}
                        <AvatarFallback>{n.actor.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    ) : (
                      <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-sm">
                        📺
                      </span>
                    )}
                    <p className="min-w-0 flex-1 text-sm">
                      {n.actor && <strong>@{n.actor.username}</strong>} {text}
                      <span className="block font-mono text-xs text-muted-foreground">
                        {new Date(n.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>
                    {!n.read && <span aria-label="unread" className="h-2 w-2 shrink-0 rounded-full bg-live" />}
                  </Link>
                </li>
              );
            })}
          </ul>
          {list.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="self-center"
            >
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
