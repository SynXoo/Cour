"use client";

import { BellIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

export function NotificationBell() {
  const { status } = useSession();
  const qc = useQueryClient();

  const { data } = useQuery({
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

  if (status !== "authed") return null;
  const count = data ?? 0;

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className="relative rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => qc.invalidateQueries({ queryKey: ["notifications"] })}
    >
      <BellIcon size={18} weight={count > 0 ? "fill" : "regular"} />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
