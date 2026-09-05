"use client";

import { ChatCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { friendAction, relationKey, type RelationState } from "@/lib/social";

/**
 * The profile's relationship row: follow (one-way, cheap), friend (mutual,
 * the request → accept state machine behind one button), message (friends
 * only), and the counts. One query feeds all of it — the API returns the
 * whole relation on every write, so each button just replaces the cache.
 */
export function FollowButton({ username }: { username: string }) {
  const { status, user } = useSession();
  const qc = useQueryClient();
  const key = relationKey(username);

  const { data } = useQuery({
    queryKey: key,
    // Wait for the session: fired during hydration the request goes out
    // anonymously and reports "not following / no friendship" for a member.
    enabled: status !== "loading",
    queryFn: async () => {
      const res = await browserApi.GET("/users/{username}/follow", {
        params: { path: { username } },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  const onDone = (state: RelationState) => {
    qc.setQueryData(key, state);
    qc.invalidateQueries({ queryKey: ["friends"] });
  };
  const onFail = (err: Error) => toast.error(err.message || "Something went wrong");

  const toggleFollow = useMutation({
    mutationFn: async (follow: boolean) => {
      const res = follow
        ? await browserApi.PUT("/users/{username}/follow", { params: { path: { username } } })
        : await browserApi.DELETE("/users/{username}/follow", { params: { path: { username } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    onSuccess: onDone,
    onError: onFail,
  });

  const friend = useMutation({
    mutationFn: async (verb: "befriend" | "unfriend") => {
      const res =
        verb === "befriend"
          ? await browserApi.PUT("/users/{username}/friend", { params: { path: { username } } })
          : await browserApi.DELETE("/users/{username}/friend", { params: { path: { username } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    onSuccess: (state, verb) => {
      onDone(state);
      if (verb === "befriend") {
        toast.success(
          state.friendship === "friends" ? `You and @${username} are friends now` : "Friend request sent",
        );
      }
    },
    onError: onFail,
  });

  const isSelf = user?.username === username;
  const action = data ? friendAction(data.friendship) : null;
  const busy = toggleFollow.isPending || friend.isPending || !data;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {status === "authed" && !isSelf && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={data?.is_following ? "secondary" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => toggleFollow.mutate(!data?.is_following)}
          >
            {data?.is_following ? "Following ✓" : "Follow"}
          </Button>
          {action && (
            <Button
              variant={action.tone}
              size="sm"
              disabled={busy}
              title={action.title}
              aria-label={action.title ? `${action.label} — ${action.title}` : undefined}
              onClick={() => {
                if (action.title === "Unfriend" && !window.confirm(`Unfriend @${username}?`)) return;
                friend.mutate(action.verb);
              }}
            >
              {action.label}
            </Button>
          )}
          {data?.friendship === "friends" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/messages/${username}`}>
                <ChatCircleIcon size={14} aria-hidden />
                Message
              </Link>
            </Button>
          )}
        </div>
      )}
      {data && (
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{data.followers}</strong> follower
          {data.followers === 1 ? "" : "s"} ·{" "}
          <strong className="text-foreground">{data.following}</strong> following ·{" "}
          <strong className="text-foreground">{data.friends}</strong> friend
          {data.friends === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
