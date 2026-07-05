"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { browserApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { useSession } from "@/lib/auth/session";

export type ListEntry = components["schemas"]["ListEntry"];
export type ListEntryWithAnime = components["schemas"]["ListEntryWithAnime"];
export type ListStatus = components["schemas"]["ListStatus"];
export type UpsertListEntry = components["schemas"]["UpsertListEntryRequest"];

export const LIST_STATUSES: { value: ListStatus; label: string }[] = [
  { value: "watching", label: "Watching" },
  { value: "completed", label: "Completed" },
  { value: "planning", label: "Planning" },
  { value: "paused", label: "Paused" },
  { value: "dropped", label: "Dropped" },
];

export function statusLabel(s: ListStatus): string {
  return LIST_STATUSES.find((x) => x.value === s)?.label ?? s;
}

const entryKey = (animeId: number) => ["list", "entry", animeId] as const;
const myListKey = ["list", "mine"] as const;
const favKey = (animeId: number) => ["favorite", animeId] as const;

/** The signed-in user's entry for one anime; null = not on the list. */
export function useMyListEntry(animeId: number) {
  const { status } = useSession();
  return useQuery({
    queryKey: entryKey(animeId),
    enabled: status === "authed",
    queryFn: async (): Promise<ListEntry | null> => {
      const res = await browserApi.GET("/me/list/{animeId}", {
        params: { path: { animeId } },
      });
      if (res.response.status === 404) return null;
      if (res.error) throw new Error(res.error.error.message);
      return res.data ?? null;
    },
  });
}

export function useUpsertEntry(animeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpsertListEntry) => {
      const res = await browserApi.PUT("/me/list/{animeId}", {
        params: { path: { animeId } },
        body,
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    onSuccess: (entry) => {
      qc.setQueryData(entryKey(animeId), entry);
      qc.invalidateQueries({ queryKey: myListKey });
    },
    onError: (err) => toast.error(err.message || "Could not save — try again."),
  });
}

export function useDeleteEntry(animeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await browserApi.DELETE("/me/list/{animeId}", {
        params: { path: { animeId } },
      });
      if (res.error && res.response.status !== 404) {
        throw new Error(res.error.error.message);
      }
    },
    onSuccess: () => {
      qc.setQueryData(entryKey(animeId), null);
      qc.invalidateQueries({ queryKey: myListKey });
    },
    onError: (err) => toast.error(err.message || "Could not remove — try again."),
  });
}

export function useMyList(status?: ListStatus) {
  const { status: sessionStatus } = useSession();
  return useQuery({
    queryKey: [...myListKey, status ?? "all"],
    enabled: sessionStatus === "authed",
    queryFn: async () => {
      const res = await browserApi.GET("/me/list", {
        params: { query: status ? { status } : {} },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });
}

export function useFavoriteState(animeId: number) {
  const { status } = useSession();
  return useQuery({
    queryKey: favKey(animeId),
    enabled: status === "authed",
    queryFn: async () => {
      const res = await browserApi.GET("/me/favorites/{animeId}", {
        params: { path: { animeId } },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.favorited;
    },
  });
}

export function useToggleFavorite(animeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: boolean) => {
      const res = next
        ? await browserApi.PUT("/me/favorites/{animeId}", { params: { path: { animeId } } })
        : await browserApi.DELETE("/me/favorites/{animeId}", { params: { path: { animeId } } });
      if (res.error) throw new Error(res.error.error.message);
      return next;
    },
    // Optimistic heart: flip immediately, roll back on failure.
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: favKey(animeId) });
      const prev = qc.getQueryData<boolean>(favKey(animeId));
      qc.setQueryData(favKey(animeId), next);
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      qc.setQueryData(favKey(animeId), ctx?.prev ?? false);
      toast.error("Could not update favorites — try again.");
    },
  });
}
