// Thread texture (M3.4): pure math behind the timestamp-density strip and the
// live-window vitals. Everything here works off data the thread view already
// holds — no extra fetches.

/** The slice of a Comment the density math needs. */
type Stamped = { id: number; timestamp_seconds: number | null; deleted: boolean };

export type DensityCluster = {
  /** Left edge of the cluster across the axis, 0–100. */
  startPct: number;
  /** Width of the cluster across the axis, 0–100. */
  widthPct: number;
  /** Timestamped comments inside the cluster. */
  count: number;
  /** Earliest-stamped comment — the jump target; reading flows forward from it. */
  firstId: number;
  /** A real stamp from the cluster's busiest bucket, for the "around 12:34" label. */
  peakSeconds: number;
};

export type CommentDensity = {
  /** Per-bucket comment counts, left→right across the episode. */
  bars: number[];
  maxCount: number;
  /** The last anchored second — the axis' right-edge label. */
  axisEnd: number;
  /** Timestamped (non-deleted) comments feeding the strip. */
  total: number;
  /** Maximal runs of adjacent non-empty buckets — the clickable regions. */
  clusters: DensityCluster[];
};

/**
 * Buckets a thread's `12:34`-anchored comments across the episode so the strip
 * can draw where the discussion concentrates. The axis spans 0:00 to the last
 * stamp (the discussion's own extent — episode runtimes aren't in the payload).
 * Deleted comments drop out, matching the timeline sort. Null when nothing is
 * timestamped — the strip hides entirely.
 */
export function commentDensity(comments: Stamped[], bucketCount = 40): CommentDensity | null {
  const stamped = comments
    .filter((c) => c.timestamp_seconds != null && !c.deleted)
    .sort((a, b) => a.timestamp_seconds! - b.timestamp_seconds! || a.id - b.id);
  if (stamped.length === 0) return null;

  const axisEnd = stamped[stamped.length - 1].timestamp_seconds!;
  const span = axisEnd + 1; // inclusive, so the last stamp lands in the last bucket
  const bars = new Array<number>(bucketCount).fill(0);
  const firstId = new Array<number | null>(bucketCount).fill(null);
  const firstStamp = new Array<number | null>(bucketCount).fill(null);
  for (const c of stamped) {
    const i = Math.min(Math.floor((c.timestamp_seconds! / span) * bucketCount), bucketCount - 1);
    bars[i] += 1;
    if (firstId[i] == null) {
      firstId[i] = c.id;
      firstStamp[i] = c.timestamp_seconds!;
    }
  }

  const clusters: DensityCluster[] = [];
  for (let i = 0; i < bucketCount; ) {
    if (bars[i] === 0) {
      i += 1;
      continue;
    }
    const start = i;
    let count = 0;
    let peak = i;
    while (i < bucketCount && bars[i] > 0) {
      count += bars[i];
      if (bars[i] > bars[peak]) peak = i;
      i += 1;
    }
    clusters.push({
      startPct: (start / bucketCount) * 100,
      widthPct: ((i - start) / bucketCount) * 100,
      count,
      firstId: firstId[start]!,
      peakSeconds: firstStamp[peak]!,
    });
  }

  return { bars, maxCount: Math.max(...bars), axisEnd, total: stamped.length, clusters };
}

const VELOCITY_WINDOW_MS = 15 * 60_000;
/** Fewer than this in the window and a per-minute rate is noise, not signal. */
const VELOCITY_FLOOR = 3;

/**
 * Comments per minute over the last 15 minutes, from the loaded pages only.
 * When older pages exist (`truncated`) and even the oldest *loaded* comment is
 * inside the window, the loaded set doesn't cover the full 15 minutes — the
 * rate is computed over the covered span instead of undercounting. Null when
 * the room isn't really moving (< 3 live comments in the window).
 */
export function threadVelocity(
  comments: { created_at: string; deleted: boolean }[],
  now: number,
  opts: { truncated?: boolean } = {},
): number | null {
  let oldest = Infinity;
  let live = 0;
  for (const c of comments) {
    const t = Date.parse(c.created_at);
    if (Number.isNaN(t)) continue;
    if (t < oldest) oldest = t;
    if (!c.deleted && now - t <= VELOCITY_WINDOW_MS) live += 1;
  }
  if (live < VELOCITY_FLOOR) return null;
  let spanMs = VELOCITY_WINDOW_MS;
  if (opts.truncated && now - oldest < VELOCITY_WINDOW_MS) {
    spanMs = Math.max(now - oldest, 60_000);
  }
  return live / (spanMs / 60_000);
}

/** "0.4/min" · "3.2/min" · "12/min" — mono-chip formatting for the rate. */
export function velocityLabel(perMin: number): string {
  return perMin >= 9.95 ? `${Math.round(perMin)}/min` : `${perMin.toFixed(1)}/min`;
}

export const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The ritual window: the episode aired within the last ~24 h. Upcoming and
 * undated episodes are never live (a finished show without per-episode dates
 * is aired, but its night has long passed — no way to know when). The clock
 * read defaults inside the helper — react-hooks/purity bars Date.now() at
 * component call sites, server components included (the isUpcoming pattern).
 */
export function withinLiveWindow(airingAt: string | null | undefined, now = Date.now()): boolean {
  if (!airingAt) return false;
  const aired = Date.parse(airingAt);
  if (Number.isNaN(aired)) return false;
  const age = now - aired;
  return age >= 0 && age <= LIVE_WINDOW_MS;
}
