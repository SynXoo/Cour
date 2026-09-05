"use client";

import { ChatCircleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useFriendsOverview, useFriendVerb } from "@/lib/hooks/use-social";
import { relativeTime } from "@/lib/notifications";
import type { FriendRequest, UserRef } from "@/lib/social";

/**
 * The friends hub (§M3.9): requests waiting on you (and the ones you sent),
 * a box to find people, the mutual follows you haven't befriended yet, and
 * the friends themselves. Everything routes through the two friend verbs.
 */
export function FriendsClient() {
  const { status, user } = useSession();
  const overview = useFriendsOverview();

  if (status === "anon") {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Friends</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Friends see each other&apos;s evenings, trade recommendations, and message directly.
        </p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  const data = overview.data;
  const loading = status === "loading" || overview.isPending;

  return (
    <div className="flex flex-col gap-8 py-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Friends</h1>
        <p className="text-sm text-muted-foreground">
          Mutual and explicit — friends follow each other automatically, can message directly, and
          show up on the shows they share with you.
        </p>
      </header>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : data ? (
        <>
          {(data.incoming.length > 0 || data.outgoing.length > 0) && (
            <section aria-labelledby="requests-heading" className="space-y-3">
              <h2 id="requests-heading" className="text-lg font-semibold tracking-tight">
                Requests
              </h2>
              <ul className="space-y-2">
                {data.incoming.map((req) => (
                  <RequestRow key={`in-${req.user.username}`} request={req} direction="incoming" />
                ))}
                {data.outgoing.map((req) => (
                  <RequestRow key={`out-${req.user.username}`} request={req} direction="outgoing" />
                ))}
              </ul>
            </section>
          )}

          <FindPeople excludeSelf={user?.username ?? ""} friends={data.friends.map((f) => f.username)} />

          {data.suggested.length > 0 && (
            <section aria-labelledby="suggested-heading" className="space-y-3">
              <div className="space-y-0.5">
                <h2 id="suggested-heading" className="text-lg font-semibold tracking-tight">
                  People you may know
                </h2>
                <p className="text-xs text-muted-foreground">
                  You follow each other already — one tap makes it official.
                </p>
              </div>
              <ul className="space-y-2">
                {data.suggested.map((u) => (
                  <PersonRow key={u.username} user={u}>
                    <AddFriendButton username={u.username} />
                  </PersonRow>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="friends-heading" className="space-y-3">
            <h2 id="friends-heading" className="text-lg font-semibold tracking-tight">
              Your friends{" "}
              <span className="font-mono text-sm font-normal text-muted-foreground">
                {data.friends.length}
              </span>
            </h2>
            {data.friends.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
                No friends yet. Find someone above, or add people from their profiles — the ones
                you keep meeting in episode threads are a good start.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.friends.map((f) => (
                  <li key={f.username}>
                    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
                      <Link href={`/users/${f.username}`} className="shrink-0">
                        <Avatar className="h-10 w-10 text-xs">
                          {f.avatar_url && <AvatarImage src={f.avatar_url} alt="" />}
                          <AvatarFallback>{f.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </Link>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/users/${f.username}`}
                          className="block truncate text-sm font-medium hover:text-primary"
                        >
                          @{f.username}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          friends since{" "}
                          {new Date(f.since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" asChild aria-label={`Message @${f.username}`}>
                        <Link href={`/messages/${f.username}`}>
                          <ChatCircleIcon size={16} aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Could not load your friends — try again.</p>
      )}
    </div>
  );
}

function PersonRow({ user, children, meta }: { user: UserRef; children: React.ReactNode; meta?: string }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
      <Link href={`/users/${user.username}`} className="shrink-0">
        <Avatar className="h-9 w-9 text-xs">
          {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
          <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/users/${user.username}`} className="block truncate text-sm font-medium hover:text-primary">
          @{user.username}
        </Link>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">{children}</div>
    </li>
  );
}

function RequestRow({ request, direction }: { request: FriendRequest; direction: "incoming" | "outgoing" }) {
  const verb = useFriendVerb(request.user.username);
  const meta = request.note
    ? `“${request.note}”`
    : direction === "incoming"
      ? `sent you a request ${relativeTime(request.created_at)} ago`
      : `you asked ${relativeTime(request.created_at)} ago`;
  return (
    <PersonRow user={request.user} meta={meta}>
      {direction === "incoming" ? (
        <>
          <Button size="sm" disabled={verb.isPending} onClick={() => verb.mutate("befriend")}>
            Accept
          </Button>
          <Button size="sm" variant="ghost" disabled={verb.isPending} onClick={() => verb.mutate("unfriend")}>
            Decline
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" disabled={verb.isPending} onClick={() => verb.mutate("unfriend")}>
          Requested · cancel
        </Button>
      )}
    </PersonRow>
  );
}

function AddFriendButton({ username }: { username: string }) {
  const verb = useFriendVerb(username);
  return (
    <Button size="sm" disabled={verb.isPending || verb.isSuccess} onClick={() => verb.mutate("befriend")}>
      {verb.isSuccess ? "Requested" : "Add friend"}
    </Button>
  );
}

function FindPeople({ excludeSelf, friends }: { excludeSelf: string; friends: string[] }) {
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 250);
  const results = useQuery({
    queryKey: ["users", "search", query],
    enabled: query.length > 0,
    queryFn: async () => {
      const res = await browserApi.GET("/users", { params: { query: { q: query } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });
  const friendSet = new Set(friends);
  const hits = (results.data ?? []).filter((u) => u.username !== excludeSelf);

  return (
    <section aria-labelledby="find-heading" className="space-y-3">
      <h2 id="find-heading" className="text-lg font-semibold tracking-tight">
        Find people
      </h2>
      <div className="relative">
        <MagnifyingGlassIcon
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by username"
          aria-label="Search people by username"
          className="h-11 pl-9 md:h-9"
          autoComplete="off"
        />
      </div>
      {query.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {results.isPending ? (
            <Skeleton className="h-14 rounded-lg" />
          ) : hits.length === 0 ? (
            <li className="text-sm text-muted-foreground">Nobody by that name.</li>
          ) : (
            hits.map((u) => (
              <PersonRow key={u.username} user={u}>
                {friendSet.has(u.username) ? (
                  <span className="self-center text-xs text-muted-foreground">Friends ✓</span>
                ) : (
                  <AddFriendButton username={u.username} />
                )}
              </PersonRow>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
