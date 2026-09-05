"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { browserApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { useSession } from "@/lib/auth/session";
import { useFeatures } from "@/lib/hooks/use-features";

export type WatchPartySummary = components["schemas"]["WatchPartySummary"];
export type PartyVisibility = components["schemas"]["PartyVisibility"];

export const openPartiesKey = (animeId?: number, episode?: number) =>
  ["parties", "open", animeId ?? null, episode ?? null] as const;

/**
 * Open parties the viewer may join — all of them for the discovery rails,
 * or one episode's for the launcher. Waits for the session to settle so an
 * authed viewer's first fetch already carries their token (followers-only
 * rooms). Polls gently: rooms open and close on the scale of minutes.
 */
export function useOpenParties(opts: { animeId?: number; episode?: number; limit?: number } = {}) {
  const { status } = useSession();
  const features = useFeatures();
  const enabled = status !== "loading" && features.data?.watch_parties === true;
  return useQuery({
    queryKey: openPartiesKey(opts.animeId, opts.episode),
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await browserApi.GET("/parties", {
        params: {
          query: {
            ...(opts.animeId != null ? { anime_id: opts.animeId } : {}),
            ...(opts.episode != null ? { episode: opts.episode } : {}),
            ...(opts.limit != null ? { limit: opts.limit } : {}),
          },
        },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data.data;
    },
  });
}

/** Start a party on an episode; resolves to the new party. */
export function useCreateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { animeId: number; episode: number; visibility: PartyVisibility }) => {
      const res = await browserApi.POST("/parties", {
        body: { anime_id: input.animeId, episode: input.episode, visibility: input.visibility },
      });
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["parties", "open"] });
    },
  });
}

/** End a party (host only). */
export function useCloseParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (partyId: number) => {
      const res = await browserApi.POST("/parties/{partyId}/close", {
        params: { path: { partyId } },
      });
      if (res.error) throw new Error(res.error.error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["parties", "open"] });
    },
  });
}
