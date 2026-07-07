"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { browserApi } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { useSession } from "@/lib/auth/session";
import { isActiveImport, type ImportJob, type ImportJobDetail } from "@/lib/imports";

export type CommitImportRequest = components["schemas"]["CommitImportRequest"];

const jobKey = (id: number | null) => ["import", "job", id] as const;

/** Validation details when present, else the envelope message. */
function apiMessage(err: { error: { message: string; details?: unknown } }): string {
  const details = err.error.details as Record<string, string> | undefined;
  return details && Object.keys(details).length > 0
    ? Object.values(details).join("; ")
    : err.error.message;
}

// ── Active-job persistence ──────────────────────────────────────────────────
// A job id only ever appears in the creation response, so a reload would
// strand an in-flight import (and its ready preview) with no way back to it.
// One slot per browser in localStorage, scoped to the user id; the storage is
// the source of truth (useSyncExternalStore), so writes re-render this tab
// and the browser's storage event re-syncs any other open tab.

const STORAGE_KEY = "cour.import.job";
const storageListeners = new Set<() => void>();

function emitStorage() {
  for (const listener of storageListeners) listener();
}

function subscribeStorage(onChange: () => void): () => void {
  storageListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    storageListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeJob(userId: number, jobId: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, jobId }));
  } catch {
    // Private mode etc. — the import still works, it just won't survive a reload.
  }
  emitStorage();
}

export function clearStoredJob() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
  emitStorage();
}

/** The signed-in user's persisted import-job id; null when none. */
export function useStoredJobId(userId: number): number | null {
  const raw = useSyncExternalStore(subscribeStorage, readStorage, () => null);
  return useMemo(() => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { userId?: number; jobId?: number };
      return parsed.userId === userId && typeof parsed.jobId === "number"
        ? parsed.jobId
        : null;
    } catch {
      return null;
    }
  }, [raw, userId]);
}

// ── Queries & mutations ─────────────────────────────────────────────────────

/**
 * One import job, polled every ~2 s while it is pending/processing/committing.
 * Resolves to null when the job no longer exists (stale stored id).
 */
export function useImportJob(jobId: number | null) {
  const { status } = useSession();
  return useQuery({
    queryKey: jobKey(jobId),
    enabled: status === "authed" && jobId != null,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && isActiveImport(data.status) ? 2000 : false;
    },
    queryFn: async (): Promise<ImportJobDetail | null> => {
      const res = await browserApi.GET("/import/jobs/{id}", {
        params: { path: { id: jobId as number } },
      });
      if (res.response.status === 404) {
        // Stale persisted id (pruned job, reset dev DB): let go of it so
        // the flow falls back to the start screen instead of a dead end.
        clearStoredJob();
        return null;
      }
      if (res.error) throw new Error(apiMessage(res.error));
      return res.data;
    },
  });
}

export function useStartAniListImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (username: string): Promise<ImportJob> => {
      const res = await browserApi.POST("/import/anilist", { body: { username } });
      if (res.error) throw new Error(apiMessage(res.error));
      return res.data;
    },
    onSuccess: (job) => qc.setQueryData(jobKey(job.id), { ...job, rows: [] }),
    onError: (err) => toast.error(err.message || "Could not start the import — try again."),
  });
}

export function useStartMALImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<ImportJob> => {
      const res = await browserApi.POST("/import/mal", {
        // The typed body is a placeholder; the serializer emits the real
        // multipart form and the browser supplies the boundary header.
        body: { file: "" },
        bodySerializer: () => {
          const fd = new FormData();
          fd.set("file", file, file.name);
          return fd;
        },
      });
      if (res.error) throw new Error(apiMessage(res.error));
      return res.data;
    },
    onSuccess: (job) => qc.setQueryData(jobKey(job.id), { ...job, rows: [] }),
    onError: (err) => toast.error(err.message || "Could not read the export — try again."),
  });
}

export function useCommitImport(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CommitImportRequest): Promise<ImportJobDetail> => {
      const res = await browserApi.POST("/import/jobs/{id}/commit", {
        params: { path: { id: jobId } },
        body,
      });
      if (res.error) throw new Error(apiMessage(res.error));
      return res.data;
    },
    onSuccess: (job) => {
      qc.setQueryData(jobKey(jobId), job);
      // The import rewrote list entries wholesale — every cached list view
      // and per-anime entry is suspect now.
      qc.invalidateQueries({ queryKey: ["list"] });
    },
    onError: (err) => {
      toast.error(err.message || "The import could not be applied — try again.");
      // A failed apply rolls back and reopens the job to `ready` with the
      // error recorded on it; refetch so the preview shows that state.
      qc.invalidateQueries({ queryKey: jobKey(jobId) });
    },
  });
}
