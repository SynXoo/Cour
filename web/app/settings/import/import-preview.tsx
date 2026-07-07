"use client";

import {
  ArrowCounterClockwiseIcon,
  PencilSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { animeHref, displayTitle } from "@/lib/anime";
import type { AnimeSummary } from "@/lib/api/client";
import { useCommitImport } from "@/lib/hooks/use-import";
import { statusLabel } from "@/lib/hooks/use-list";
import {
  buildResolutions,
  partitionRows,
  summarizeCommit,
  type CommitMode,
  type ImportJobDetail,
  type ImportRow,
  type RowPicks,
} from "@/lib/imports";
import { AnimePicker } from "./anime-picker";

// Rows render in chunks so a 10k-entry export doesn't hit the DOM at once.
const CHUNK = 100;

export function ImportPreview({
  job,
  onDiscard,
}: {
  job: ImportJobDetail;
  onDiscard: () => void;
}) {
  const [mode, setMode] = useState<CommitMode>("merge");
  const [picks, setPicks] = useState<RowPicks>(new Map());
  const [pickerRow, setPickerRow] = useState<ImportRow | null>(null);
  const [visibleReview, setVisibleReview] = useState(CHUNK);
  const [visibleMatched, setVisibleMatched] = useState(CHUNK);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const commit = useCommitImport(job.id);
  const { review, matched } = useMemo(() => partitionRows(job.rows), [job.rows]);
  const summary = summarizeCommit(job.rows, picks, mode);
  const { counts } = job;

  function setPick(rowIndex: number, value: AnimeSummary | null | undefined) {
    setPicks((prev) => {
      const next = new Map(prev);
      if (value === undefined) next.delete(rowIndex);
      else next.set(rowIndex, value);
      return next;
    });
  }

  function apply() {
    commit.mutate({
      mode,
      resolutions: picks.size > 0 ? buildResolutions(picks) : undefined,
    });
  }

  const sourceLabel = job.source === "anilist" ? "AniList" : "MyAnimeList";

  return (
    <div className="flex flex-col gap-6">
      {job.error && (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>The last apply didn’t stick</AlertTitle>
          <AlertDescription>
            {job.error} — nothing was written; applying again is safe.
          </AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Review your import</h2>
        <p className="text-sm text-muted-foreground">
          {counts.total.toLocaleString()} entries from {sourceLabel} ·{" "}
          {counts.matched.toLocaleString()} matched
          {counts.review > 0 && <> · {counts.review.toLocaleString()} need review</>}
          {counts.conflicts > 0 && (
            <> · {counts.conflicts.toLocaleString()} already on your list</>
          )}
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4">
        {counts.conflicts > 0 ? (
          <p className="text-sm">
            <strong>
              {counts.conflicts.toLocaleString()}{" "}
              {counts.conflicts === 1 ? "title is" : "titles are"} already on your
              list.
            </strong>{" "}
            Merge keeps your entries; overwrite takes the import’s status, score
            and progress.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing here collides with your list, so merge and overwrite act the
            same.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Conflict mode">
          <Button
            type="button"
            size="sm"
            variant={mode === "merge" ? "secondary" : "outline"}
            aria-pressed={mode === "merge"}
            onClick={() => setMode("merge")}
          >
            Merge — keep my entries
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "overwrite" ? "secondary" : "outline"}
            aria-pressed={mode === "overwrite"}
            onClick={() => setMode("overwrite")}
          >
            Overwrite — the import wins
          </Button>
        </div>

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {[
            `${summary.importing.toLocaleString()} to import`,
            summary.mergeSkips > 0
              ? `${summary.mergeSkips.toLocaleString()} kept as-is (already on your list)`
              : null,
            summary.unresolved > 0
              ? `${summary.unresolved.toLocaleString()} unresolved (left out)`
              : null,
            summary.excluded > 0 ? `${summary.excluded.toLocaleString()} excluded` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={apply}
            disabled={commit.isPending || summary.importing === 0}
          >
            {commit.isPending ? "Applying…" : "Apply import"}
          </Button>
          <Button
            type="button"
            variant={confirmDiscard ? "destructive" : "ghost"}
            onClick={() => (confirmDiscard ? onDiscard() : setConfirmDiscard(true))}
            onBlur={() => setConfirmDiscard(false)}
          >
            {confirmDiscard ? "Really discard?" : "Discard preview"}
          </Button>
        </div>
      </section>

      {review.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Needs review ({review.length.toLocaleString()})</h3>
          <p className="text-xs text-muted-foreground">
            No confident catalog match. Pick the right title — anything left
            unresolved is simply not imported.
          </p>
          <ul className="divide-y divide-border/60">
            {review.slice(0, visibleReview).map((row) => (
              <ReviewRow
                key={row.row_index}
                row={row}
                pick={picks.get(row.row_index)}
                onFind={() => setPickerRow(row)}
                onClear={() => setPick(row.row_index, undefined)}
              />
            ))}
          </ul>
          <ShowMore
            shown={visibleReview}
            total={review.length}
            onMore={() => setVisibleReview((v) => v + 2 * CHUNK)}
          />
        </section>
      )}

      {matched.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Matched ({matched.length.toLocaleString()})</h3>
          <ul className="divide-y divide-border/60">
            {matched.slice(0, visibleMatched).map((row) => (
              <MatchedRow
                key={row.row_index}
                row={row}
                pick={picks.get(row.row_index)}
                onChange={() => setPickerRow(row)}
                onExclude={() => setPick(row.row_index, null)}
                onRestore={() => setPick(row.row_index, undefined)}
              />
            ))}
          </ul>
          <ShowMore
            shown={visibleMatched}
            total={matched.length}
            onMore={() => setVisibleMatched((v) => v + 2 * CHUNK)}
          />
        </section>
      )}

      {pickerRow != null && (
        <PickerForRow
          row={pickerRow}
          onPick={(anime) => setPick(pickerRow.row_index, anime)}
          onClose={() => setPickerRow(null)}
        />
      )}
    </div>
  );
}

function PickerForRow({
  row,
  onPick,
  onClose,
}: {
  row: ImportRow;
  onPick: (anime: AnimeSummary) => void;
  onClose: () => void;
}) {
  return (
    <AnimePicker
      key={row.row_index}
      sourceTitle={row.title}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onPick={onPick}
    />
  );
}

function ShowMore({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  if (shown >= total) return null;
  return (
    <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onMore}>
      Show more ({(total - shown).toLocaleString()} remaining)
    </Button>
  );
}

/** "Watching · ★ 8 · ep 12" — the entry as it will be written. */
function rowMeta(row: ImportRow): string {
  return [
    statusLabel(row.status),
    row.score != null ? `★ ${row.score}` : null,
    row.progress > 0 ? `ep ${row.progress}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Thumb({ anime }: { anime: AnimeSummary }) {
  return anime.cover_image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={anime.cover_image}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-14 w-10 shrink-0 rounded-xs border border-border/60 object-cover"
      style={anime.cover_color ? { backgroundColor: anime.cover_color } : undefined}
    />
  ) : (
    <span className="h-14 w-10 shrink-0 rounded-xs border border-border/60 bg-muted" />
  );
}

function ReviewRow({
  row,
  pick,
  onFind,
  onClear,
}: {
  row: ImportRow;
  pick: AnimeSummary | null | undefined;
  onFind: () => void;
  onClear: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.title}</p>
        <p className="text-xs text-muted-foreground">{rowMeta(row)}</p>
      </div>
      {pick ? (
        <div className="flex min-w-0 items-center gap-2">
          <Thumb anime={pick} />
          <span className="min-w-0 truncate text-sm">{displayTitle(pick)}</span>
          <Button type="button" size="sm" variant="outline" onClick={onFind}>
            Change
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" className="self-start sm:self-auto" onClick={onFind}>
          Find match
        </Button>
      )}
    </li>
  );
}

function MatchedRow({
  row,
  pick,
  onChange,
  onExclude,
  onRestore,
}: {
  row: ImportRow;
  pick: AnimeSummary | null | undefined;
  onChange: () => void;
  onExclude: () => void;
  onRestore: () => void;
}) {
  const excluded = pick === null;
  // A re-match through the picker displays (and imports) over the original.
  const target = pick ?? row.anime;
  const targetTitle = target ? displayTitle(target) : row.title;
  const sourceDiffers =
    target != null &&
    row.title.toLowerCase() !== target.title.toLowerCase() &&
    row.title.toLowerCase() !== (target.title_english ?? "").toLowerCase();

  return (
    <li
      className={`flex items-center gap-3 py-3 ${excluded ? "opacity-45" : ""}`}
      aria-label={excluded ? `${targetTitle} — excluded` : undefined}
    >
      {target && <Thumb anime={target} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {target ? (
            <Link
              href={animeHref(target)}
              target="_blank"
              className="hover:text-primary hover:underline"
            >
              {targetTitle}
            </Link>
          ) : (
            row.title
          )}
        </p>
        {sourceDiffers && (
          <p className="truncate text-xs text-muted-foreground">
            in your export: “{row.title}”
          </p>
        )}
        {/* Badges ride with the meta text: in the right-hand action cluster
            they'd starve the title of width on narrow screens. */}
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {rowMeta(row)}
          {pick ? (
            <Badge variant="outline">re-matched</Badge>
          ) : (
            row.match === "title" && <Badge variant="outline">title match</Badge>
          )}
          {row.on_list && !excluded && <Badge variant="secondary">on your list</Badge>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!excluded && (pick || row.match === "title") && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Change match for ${row.title}`}
            onClick={onChange}
          >
            <PencilSimpleIcon />
          </Button>
        )}
        {excluded ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Include ${row.title} again`}
            onClick={onRestore}
          >
            <ArrowCounterClockwiseIcon />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Leave out ${row.title}`}
            onClick={onExclude}
          >
            <XIcon />
          </Button>
        )}
      </div>
    </li>
  );
}
