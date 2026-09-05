"use client";

import { ChatCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

/**
 * The header's messages entry: an icon that carries the unread count. Same
 * cadence as the bell (a minute, plus window focus) — a DM is the one social
 * event with no notification row, so this badge is its only signal.
 */
export function InboxBadge() {
  const { status } = useSession();
  const pathname = usePathname();
  const active = pathname === "/messages" || pathname.startsWith("/messages/");

  const unread = useQuery({
    queryKey: ["messages", "unread"],
    enabled: status === "authed",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await browserApi.GET("/me/messages/unread-count", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data.count;
    },
  });

  if (status !== "authed") return null;
  const count = unread.data ?? 0;

  return (
    <Link
      href="/messages"
      aria-label={count > 0 ? `Messages, ${count} unread` : "Messages"}
      aria-current={active ? "page" : undefined}
      className={`relative rounded-md p-2 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      <ChatCircleIcon size={18} weight={count > 0 || active ? "fill" : "regular"} />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
