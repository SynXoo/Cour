import type { components } from "@/lib/api/schema";

export type ImportJob = components["schemas"]["ImportJob"];
export type ImportJobDetail = components["schemas"]["ImportJobDetail"];
export type ImportRow = components["schemas"]["ImportRow"];
export type ImportStatus = components["schemas"]["ImportStatus"];
export type ImportCounts = components["schemas"]["ImportCounts"];
export type ImportResolution = components["schemas"]["ImportResolution"];
export type CommitMode = components["schemas"]["CommitImportRequest"]["mode"];

/**
 * The user's per-row decisions on the preview screen, keyed by `row_index`:
 * an anime summary = "import into this title", null = "leave this row out",
 * absent = untouched (matched rows import as-is; review rows are skipped).
 */
export type RowPicks = Map<number, components["schemas"]["AnimeSummary"] | null>;

/** Statuses the UI keeps polling through (~2 s). */
export function isActiveImport(status: ImportStatus): boolean {
  return status === "pending" || status === "processing" || status === "committing";
}

export function partitionRows(rows: ImportRow[]): {
  review: ImportRow[];
  matched: ImportRow[];
} {
  const review: ImportRow[] = [];
  const matched: ImportRow[] = [];
  for (const row of rows) (row.match === "review" ? review : matched).push(row);
  return { review, matched };
}

/** The commit payload's `resolutions`, ordered by row index. */
export function buildResolutions(picks: RowPicks): ImportResolution[] {
  return [...picks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row_index, anime]) => ({ row_index, anime_id: anime?.id ?? null }));
}

export type CommitSummary = {
  /** Rows the commit should write. */
  importing: number;
  /** Rows the user explicitly left out. */
  excluded: number;
  /** Review rows without a pick — skipped by the server. */
  unresolved: number;
  /** Preview-time conflicts merge mode will skip. */
  mergeSkips: number;
};

/**
 * Client-side prediction of the commit outcome for the summary line. The
 * server recomputes against the live list (and dedupes repeated targets), so
 * this is a preview, not a promise — `on_list` is as of preview time.
 */
export function summarizeCommit(
  rows: ImportRow[],
  picks: RowPicks,
  mode: CommitMode,
): CommitSummary {
  const out: CommitSummary = { importing: 0, excluded: 0, unresolved: 0, mergeSkips: 0 };
  for (const row of rows) {
    const pick = picks.get(row.row_index);
    if (pick === null) {
      out.excluded++;
    } else if (row.match === "review" && pick === undefined) {
      out.unresolved++;
    } else if (mode === "merge" && row.on_list && pick === undefined) {
      out.mergeSkips++;
    } else {
      out.importing++;
    }
  }
  return out;
}
