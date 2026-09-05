"use client";

import { useQuery } from "@tanstack/react-query";
import { browserApi } from "@/lib/api/client";

/**
 * Which optional features this deployment has switched on. Server-driven so
 * a flag flip needs no web rebuild; cached for the session (flags don't
 * change under a running tab).
 */
export function useFeatures() {
  return useQuery({
    queryKey: ["features"],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await browserApi.GET("/features", {});
      if (res.error) throw new Error(res.error.error.message);
      return res.data;
    },
  });
}
