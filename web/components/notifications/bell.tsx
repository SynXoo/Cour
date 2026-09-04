"use client";

import { BellIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import {
  NOTIFICATION_FILTERS,
  describeNotification,
  relativeTime,
  type NotificationType,
} from "@/lib/notifications";

// The panel is a peek, not the archive — deeper history lives on /notifications.
const PANEL_LIMIT = 8;

export function NotificationBell() {
  const { status } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationType | null>(null);

  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    enabled: status === "authed",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await browserApi.GET("/me/notifications/unread-count", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data.count;
    },
  });

  const list = useQuery({
    queryKey: ["notifications", "panel", filter],
    // Only while the panel is open: the badge poll is the background cost.
    enabled: status === "authed" && open,
    queryFn: async () => {
      const res = await browserApi.GET("/me/notifications", {
        params: { query: { limit: PANEL_LIMIT, ...(filter ? { type: filter } : {}) } },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });

  const markRead = useMutation({
    mutationFn: async (body: { ids?: number[]; all: boolean }) => {
      // keepalive: opening a notification navigates away in the same tick,
      // which would otherwise abort the in-flight mark-read.
      await browserApi.POST("/me/notifications/read", { body, keepalive: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (status !== "authed") return null;
  const count = unread.data ?? 0;
  const items = list.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        className="relative rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <BellIcon size={18} weight={count > 0 ? "fill" : "regular"} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-live px-1 font-mono text-[10px] font-bold text-live-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] gap-0 p-0 sm:w-96">
        <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
          <h2 className="text-sm font-semibold tracking-tight">Notifications</h2>
          {count > 0 && (
            <button
              type="button"
              onClick={() => markRead.mutate({ all: true })}
              disabled={markRead.isPending}
              className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>

        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5 px-3 pb-2">
          {NOTIFICATION_FILTERS.map((f) => (
            <Chip
              key={f.label}
              active={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="h-7 px-2.5 text-xs"
            >
              {f.label}
            </Chip>
          ))}
        </div>

        <div className="max-h-80 overflow-y-auto border-t border-border/60">
          {list.isPending ? (
            <div className="space-y-1.5 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">
              {filter ? "Nothing of this kind yet." : "Nothing yet — replies, follows, and fresh episodes land here."}
            </p>
          ) : (
            <ul>
              {items.map((n) => {
                const { text, href } = describeNotification(n);
                return (
                  <li key={n.id} className="border-b border-border/40 last:border-b-0">
                    <Link
                      href={href}
                      onClick={() => {
                        setOpen(false);
                        if (!n.read) markRead.mutate({ ids: [n.id], all: false });
                      }}
                      className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent ${
                        n.read ? "opacity-60" : ""
                      }`}
                    >
                      {n.actor ? (
                        <Avatar className="h-7 w-7 shrink-0 text-[10px]">
                          {n.actor.avatar_url && <AvatarImage src={n.actor.avatar_url} alt="" />}
                          <AvatarFallback>{n.actor.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      ) : (
                        <span
                          aria-hidden
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs"
                        >
                          📺
                        </span>
                      )}
                      <p className="min-w-0 flex-1 text-xs leading-snug">
                        {n.actor && <strong>@{n.actor.username}</strong>} {text}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                          {relativeTime(n.created_at)}
                        </span>
                      </p>
                      {!n.read && (
                        <span aria-label="unread" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-live" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border/60 p-1.5">
          <Button variant="ghost" size="sm" asChild className="w-full text-xs">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              View all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
