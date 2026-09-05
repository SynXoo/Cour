"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { relationKey, type RelationState } from "@/lib/social";

/** Friends, pending requests both ways, and suggestions — the /friends hub. */
export function useFriendsOverview() {
  const { status } = useSession();
  return useQuery({
    queryKey: ["friends", "overview"],
    enabled: status === "authed",
    queryFn: async () => {
      const res = await browserApi.GET("/me/friends", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });
}

/** The viewer's friends on one show, plus who recommended it to them. */
export function useAnimeFriends(animeId: number) {
  const { status } = useSession();
  return useQuery({
    queryKey: ["friends", "anime", animeId],
    enabled: status === "authed",
    staleTime: 30_000,
    queryFn: async () => {
      const res = await browserApi.GET("/anime/{id}/friends", { params: { path: { id: animeId } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });
}

/**
 * The two friend verbs against one user. Every response is the full
 * relation, so the profile's cache is replaced and every friends list is
 * invalidated — a request accepted on /friends flips the profile too.
 */
export function useFriendVerb(username: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (verb: "befriend" | "unfriend") => {
      const res =
        verb === "befriend"
          ? await browserApi.PUT("/users/{username}/friend", { params: { path: { username } } })
          : await browserApi.DELETE("/users/{username}/friend", { params: { path: { username } } });
      if (res.error) throw new Error(res.error.error.message);
      return res.data as RelationState;
    },
    onSuccess: (state) => {
      qc.setQueryData(relationKey(username), state);
      qc.invalidateQueries({ queryKey: ["friends"] });
    },
    onError: (err) => toast.error(err.message || "Something went wrong"),
  });
}
