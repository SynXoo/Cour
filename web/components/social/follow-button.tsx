"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

export function FollowButton({ username }: { username: string }) {
  const { status, user } = useSession();
  const qc = useQueryClient();
  const key = ["follow", username];

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await browserApi.GET("/users/{username}/follow", {
        params: { path: { username } },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });

  const toggle = useMutation({
    mutationFn: async (follow: boolean) => {
      const res = follow
        ? await browserApi.PUT("/users/{username}/follow", { params: { path: { username } } })
        : await browserApi.DELETE("/users/{username}/follow", { params: { path: { username } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    onSuccess: (state) => qc.setQueryData(key, state),
    onError: (err) => toast.error(err.message || "Something went wrong"),
  });

  const isSelf = user?.username === username;

  return (
    <div className="flex items-center gap-3">
      {status === "authed" && !isSelf && (
        <Button
          variant={data?.is_following ? "secondary" : "default"}
          size="sm"
          disabled={toggle.isPending || !data}
          onClick={() => toggle.mutate(!data?.is_following)}
        >
          {data?.is_following ? "Following ✓" : "Follow"}
        </Button>
      )}
      {data && (
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{data.followers}</strong> follower
          {data.followers === 1 ? "" : "s"} ·{" "}
          <strong className="text-foreground">{data.following}</strong> following
        </p>
      )}
    </div>
  );
}
