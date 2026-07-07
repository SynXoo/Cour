"use client";

import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/session";
import {
  clearStoredJob,
  storeJob,
  useImportJob,
  useStoredJobId,
} from "@/lib/hooks/use-import";
import type { ImportJob, ImportJobDetail } from "@/lib/imports";
import { ImportPreview } from "./import-preview";
import { ImportStart } from "./import-start";

export function ImportClient() {
  const { status, user } = useSession();

  if (status === "loading") {
    return <Skeleton className="mt-8 h-64 rounded-lg" />;
  }
  if (status === "anon" || !user) {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Import your list</h1>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  return <ImportFlow key={user.id} userId={user.id} />;
}

function ImportFlow({ userId }: { userId: number }) {
  // The persisted job id is the flow's state: writing it moves the screen
  // forward, clearing it returns to the start, and a reload resumes where
  // the user left off.
  const jobId = useStoredJobId(userId);
  const { data: job, isPending, isError, refetch } = useImportJob(jobId);

  function started(job: ImportJob) {
    storeJob(userId, job.id);
  }

  return (
    <div className="flex flex-col gap-6 py-4">
      <header className="flex flex-col gap-1">
        <Link
          href="/settings"
          className="self-start text-xs text-muted-foreground hover:text-foreground"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Import your list</h1>
        <p className="text-sm text-muted-foreground">
          Bring your AniList or MyAnimeList history into Cour. You preview every
          match before anything is written.
        </p>
      </header>

      {jobId == null ? (
        <ImportStart onStarted={started} />
      ) : isError ? (
        <StatusPane icon="error" title="Couldn’t load your import.">
          <div className="flex gap-2">
            <Button onClick={() => refetch()}>Retry</Button>
            <Button variant="ghost" onClick={clearStoredJob}>
              Start over
            </Button>
          </div>
        </StatusPane>
      ) : isPending || job == null ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <JobScreen job={job} onReset={clearStoredJob} />
      )}
    </div>
  );
}

function JobScreen({ job, onReset }: { job: ImportJobDetail; onReset: () => void }) {
  switch (job.status) {
    case "pending":
    case "processing":
      return (
        <StatusPane
          icon="spinner"
          title={
            // The AniList fetch dominates that path (rate budget shared with
            // the sync crawls); MAL parses at upload, so it's matching.
            job.source === "anilist"
              ? "Fetching your AniList library…"
              : "Matching against the catalog…"
          }
        >
          {job.counts.total > 0 && (
            <p className="text-sm text-muted-foreground">
              {job.counts.total.toLocaleString()} entries parsed
            </p>
          )}
        </StatusPane>
      );

    case "committing":
      return <StatusPane icon="spinner" title="Applying to your list…" />;

    case "ready":
      return <ImportPreview job={job} onDiscard={onReset} />;

    case "done":
      return (
        <StatusPane
          icon="done"
          title={`Imported ${job.counts.applied.toLocaleString()} ${
            job.counts.applied === 1 ? "title" : "titles"
          }`}
        >
          {job.counts.skipped > 0 && (
            <p className="text-sm text-muted-foreground">
              {job.counts.skipped.toLocaleString()} skipped — already on your
              list, unresolved, or excluded.
            </p>
          )}
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/list">See my list</Link>
            </Button>
            <Button variant="outline" onClick={onReset}>
              Import another
            </Button>
          </div>
        </StatusPane>
      );

    case "failed":
      return (
        <StatusPane icon="error" title="This import failed.">
          {job.error && <p className="text-sm text-muted-foreground">{job.error}</p>}
          <Button onClick={onReset}>
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Start over
          </Button>
        </StatusPane>
      );

    case "superseded":
      return (
        <StatusPane
          icon="error"
          title="A newer import replaced this one."
        >
          <p className="text-sm text-muted-foreground">
            Looks like an import was started somewhere else — only the newest
            one keeps its preview.
          </p>
          <Button onClick={onReset}>Start over</Button>
        </StatusPane>
      );
  }
}

function StatusPane({
  icon,
  title,
  children,
}: {
  icon: "spinner" | "done" | "error";
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-3 py-20 text-center">
      {icon === "spinner" && (
        <CircleNotchIcon
          aria-hidden
          className="size-8 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      )}
      {icon === "done" && <CheckCircleIcon aria-hidden weight="fill" className="size-8 text-primary" />}
      {icon === "error" && (
        <WarningCircleIcon aria-hidden className="size-8 text-destructive" />
      )}
      <p aria-live="polite" className="text-lg font-semibold">
        {title}
      </p>
      {children}
    </section>
  );
}
