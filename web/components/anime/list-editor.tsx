"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/session";
import {
  LIST_STATUSES,
  statusLabel,
  useDeleteEntry,
  useMyListEntry,
  useUpsertEntry,
  type ListEntry,
  type ListStatus,
} from "@/lib/hooks/use-list";

export function ListEditor({
  animeId,
  episodesCount,
}: {
  animeId: number;
  episodesCount: number | null;
}) {
  const { status: sessionStatus } = useSession();
  const { data: entry, isLoading } = useMyListEntry(animeId);

  if (sessionStatus === "loading") {
    return <Skeleton className="h-9 w-32" />;
  }
  if (sessionStatus === "anon") {
    return (
      <Button asChild>
        <Link href="/login">Sign in to track</Link>
      </Button>
    );
  }
  if (isLoading) {
    return <Skeleton className="h-9 w-32" />;
  }

  return <EditorDialog animeId={animeId} episodesCount={episodesCount} entry={entry ?? null} />;
}

function EditorDialog({
  animeId,
  episodesCount,
  entry,
}: {
  animeId: number;
  episodesCount: number | null;
  entry: ListEntry | null;
}) {
  const [open, setOpen] = useState(false);

  const triggerLabel = entry
    ? [
        statusLabel(entry.status),
        entry.progress > 0 ? `${entry.progress}${episodesCount ? `/${episodesCount}` : ""}` : null,
        entry.score ? `★${entry.score}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Add to list";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* The trigger label is pure data (status · progress · score). */}
        <Button variant={entry ? "secondary" : "default"} className={entry ? "font-mono" : undefined}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {/* Radix unmounts content on close, so this form's initializers
            re-run on every open — no reset effect needed. */}
        <EditorForm
          animeId={animeId}
          episodesCount={episodesCount}
          entry={entry}
          close={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  animeId,
  episodesCount,
  entry,
  close,
}: {
  animeId: number;
  episodesCount: number | null;
  entry: ListEntry | null;
  close: () => void;
}) {
  const [status, setStatus] = useState<ListStatus>(entry?.status ?? "watching");
  const [score, setScore] = useState<string>(entry?.score?.toString() ?? "none");
  const [progress, setProgress] = useState<string>(entry?.progress.toString() ?? "0");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const upsert = useUpsertEntry(animeId);
  const remove = useDeleteEntry(animeId);

  async function save() {
    await upsert.mutateAsync({
      status,
      score: score === "none" ? 0 : Number(score),
      progress: Math.max(0, Number(progress) || 0),
    });
    close();
  }

  async function removeEntry() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    await remove.mutateAsync();
    close();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{entry ? "Update entry" : "Add to your list"}</DialogTitle>
        <DialogDescription>
          Reaching the final episode marks it completed automatically.
        </DialogDescription>
      </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="le-status">Status</FieldLabel>
            <Select value={status} onValueChange={(v) => setStatus(v as ListStatus)}>
              <SelectTrigger id="le-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIST_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="le-score">Score</FieldLabel>
              <Select value={score} onValueChange={setScore}>
                <SelectTrigger id="le-score">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No score</SelectItem>
                  {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} — {SCORE_WORDS[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="le-progress">
                Episodes{episodesCount ? ` (of ${episodesCount})` : ""}
              </FieldLabel>
              <Input
                id="le-progress"
                type="number"
                min={0}
                max={episodesCount ?? undefined}
                inputMode="numeric"
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
              />
            </Field>
          </div>
        </FieldGroup>

        <DialogFooter className="gap-2 sm:justify-between">
          {entry ? (
            <Button
              type="button"
              variant={confirmRemove ? "destructive" : "ghost"}
              onClick={removeEntry}
              disabled={remove.isPending}
            >
              {confirmRemove ? "Really remove?" : "Remove"}
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
    </>
  );
}

const SCORE_WORDS: Record<number, string> = {
  10: "masterpiece",
  9: "great",
  8: "very good",
  7: "good",
  6: "fine",
  5: "average",
  4: "bad",
  3: "very bad",
  2: "horrible",
  1: "appalling",
};
