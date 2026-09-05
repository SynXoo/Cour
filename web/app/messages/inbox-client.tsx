"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { relativeTime } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/**
 * The inbox (§M3.9): one row per conversation, newest activity first, the
 * peer's unread count on the right. Friends only, so there's no "message
 * requests" tab to invent — the friendship is the filter.
 */
export function InboxClient() {
  const { status } = useSession();

  const inbox = useQuery({
    queryKey: ["messages", "inbox"],
    enabled: status === "authed",
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await browserApi.GET("/me/messages", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });

  if (status === "anon") {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Direct messages between friends — sign in to see yours.
        </p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  const rows = inbox.data ?? [];

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <Link href="/friends" className="text-sm text-muted-foreground hover:text-primary">
          Friends →
        </Link>
      </div>

      {status === "loading" || inbox.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
          No conversations yet. Open a friend&apos;s profile and hit Message — or{" "}
          <Link href="/friends" className="underline underline-offset-4 hover:text-primary">
            find a friend
          </Link>{" "}
          first.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.peer.username}>
              <Link
                href={`/messages/${row.peer.username}`}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/50",
                  row.unread > 0 && "border-primary/40",
                )}
              >
                <Avatar className="h-10 w-10 text-xs">
                  {row.peer.avatar_url && <AvatarImage src={row.peer.avatar_url} alt="" />}
                  <AvatarFallback>{row.peer.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("truncate text-sm", row.unread > 0 ? "font-semibold" : "font-medium")}>
                      @{row.peer.username}
                    </p>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {relativeTime(row.last_at)}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "truncate text-sm",
                      row.unread > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {row.last_mine && <span className="text-muted-foreground">You: </span>}
                    {row.last_body}
                  </p>
                </div>
                {row.unread > 0 && (
                  <span
                    aria-label={`${row.unread} unread`}
                    className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[11px] font-bold text-primary-foreground"
                  >
                    {row.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
