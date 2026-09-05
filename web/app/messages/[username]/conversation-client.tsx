"use client";

import { ArrowLeftIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useFriendVerb } from "@/lib/hooks/use-social";
import { chronological, friendAction, relationKey, sameGroup } from "@/lib/social";
import { cn } from "@/lib/utils";

const PAGE = 50;
// Inside an open conversation the poll is quick; the badge elsewhere stays
// at a minute. Both stop when the tab is hidden.
const POLL_MS = 4_000;

/**
 * One conversation (§M3.9): bubbles oldest-first, older pages on demand,
 * a composer that sends on Enter. Friends only — with anyone else the
 * composer explains and offers the friend button instead.
 */
export function ConversationClient({ username }: { username: string }) {
  const { status, user } = useSession();
  const qc = useQueryClient();

  const relation = useQuery({
    queryKey: relationKey(username),
    enabled: status === "authed",
    queryFn: async () => {
      const res = await browserApi.GET("/users/{username}/follow", { params: { path: { username } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  const thread = useInfiniteQuery({
    queryKey: ["messages", "thread", username],
    enabled: status === "authed",
    initialPageParam: 0,
    // Interval refetches already pause while the window is in the background,
    // and the poll makes a focus refetch redundant.
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }) => {
      const res = await browserApi.GET("/me/messages/{username}", {
        params: {
          path: { username },
          query: { limit: PAGE, ...(pageParam > 0 ? { before_id: pageParam } : {}) },
        },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const messages = useMemo(() => chronological((thread.data?.pages ?? []).map((p) => p.data)), [thread.data]);
  const latestId = messages.length > 0 ? messages[messages.length - 1].id : 0;
  const latestFromPeer = messages.length > 0 && !messages[messages.length - 1].mine;

  // Reading is a side effect of seeing: whenever the newest message is the
  // peer's and the tab is visible, move the pointer and clear the badge. A
  // conversation opened in a background tab marks itself read the moment
  // the tab is looked at.
  useEffect(() => {
    if (!latestFromPeer) return;
    const markRead = () => {
      if (document.visibilityState !== "visible") return;
      browserApi
        .POST("/me/messages/{username}/read", { params: { path: { username } } })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["messages", "unread"] });
          qc.invalidateQueries({ queryKey: ["messages", "inbox"] });
        })
        .catch(() => {});
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [latestId, latestFromPeer, username, qc]);

  // Keep the newest message in view as they arrive (or as you send).
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [latestId]);

  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: async (text: string) => {
      const res = await browserApi.POST("/me/messages/{username}", {
        params: { path: { username } },
        body: { body: text },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    onSuccess: () => {
      setBody("");
      // Sending moves your own read pointer past everything, so the badge
      // for this thread drops to zero too.
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (err) => toast.error(err.message || "Could not send — try again."),
  });

  const friendVerb = useFriendVerb(username);

  if (status === "anon") {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  const isSelf = user?.username === username;
  const friends = relation.data?.friendship === "friends";
  const action = relation.data ? friendAction(relation.data.friendship) : null;
  const canSend = friends && body.trim() !== "" && !send.isPending;

  function submit() {
    const text = body.trim();
    if (!text || !friends) return;
    send.mutate(text);
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild aria-label="Back to messages">
          <Link href="/messages">
            <ArrowLeftIcon size={16} aria-hidden />
          </Link>
        </Button>
        <Link href={`/users/${username}`} className="flex min-w-0 items-center gap-2.5">
          <Avatar className="h-9 w-9 text-xs">
            <AvatarFallback>{username.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <h1 className="truncate text-lg font-semibold tracking-tight hover:text-primary">@{username}</h1>
        </Link>
      </header>

      <section
        aria-label={`Conversation with @${username}`}
        className="flex max-h-[60vh] min-h-[16rem] flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 bg-card p-3"
      >
        {status === "loading" || thread.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className={cn("h-10 w-2/3 rounded-2xl", i % 2 === 1 && "ml-auto")} />
            ))}
          </div>
        ) : thread.isError ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{thread.error.message}</p>
        ) : (
          <>
            {thread.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center text-xs"
                onClick={() => thread.fetchNextPage()}
                disabled={thread.isFetchingNextPage}
              >
                {thread.isFetchingNextPage ? "Loading…" : "Load older"}
              </Button>
            )}
            {messages.length === 0 && (
              <p className="my-auto py-10 text-center text-sm text-muted-foreground">
                {isSelf
                  ? "That's you."
                  : friends
                    ? "Say hi — this is the start of your conversation."
                    : "Nothing here yet."}
              </p>
            )}
            {messages.map((m, i) => {
              const prev = i > 0 ? messages[i - 1] : null;
              const grouped = prev != null && sameGroup(prev, m);
              return (
                <div
                  key={m.id}
                  className={cn("flex flex-col", m.mine ? "items-end" : "items-start", !grouped && i > 0 && "mt-2")}
                >
                  <p
                    className={cn(
                      "max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-1.5 text-sm leading-relaxed",
                      m.mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    {m.body}
                  </p>
                  {!grouped && (
                    <time
                      dateTime={m.created_at}
                      className="mt-0.5 px-1 font-mono text-[10px] text-muted-foreground"
                    >
                      {new Date(m.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  )}
                </div>
              );
            })}
            <div ref={bottom} />
          </>
        )}
      </section>

      {relation.data && !friends && !isSelf ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          <span>Messages are for friends. Add @{username} and the composer opens.</span>
          {action && (
            <Button
              size="sm"
              variant={action.tone}
              disabled={friendVerb.isPending}
              onClick={() => friendVerb.mutate(action.verb)}
            >
              {action.label}
            </Button>
          )}
        </div>
      ) : (
        !isSelf && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={friends ? `Message @${username}` : "Loading…"}
              aria-label="Message"
              disabled={!friends}
              maxLength={2000}
              className="min-h-11 resize-none"
            />
            <Button type="submit" disabled={!canSend} className="h-11 shrink-0" aria-label="Send">
              <PaperPlaneRightIcon size={16} aria-hidden />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </form>
        )
      )}
    </div>
  );
}
