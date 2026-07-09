import { describe, expect, it } from "vitest";
import {
  commentDensity,
  LIVE_WINDOW_MS,
  threadVelocity,
  velocityLabel,
  withinLiveWindow,
} from "./thread-texture";

const stamped = (id: number, timestamp_seconds: number | null, deleted = false) => ({
  id,
  timestamp_seconds,
  deleted,
});

describe("commentDensity", () => {
  it("is null with no timestamped comments (the strip hides)", () => {
    expect(commentDensity([])).toBeNull();
    expect(commentDensity([stamped(1, null), stamped(2, null)])).toBeNull();
  });

  it("drops deleted comments, matching the timeline sort", () => {
    expect(commentDensity([stamped(1, 30, true)])).toBeNull();
    const d = commentDensity([stamped(1, 30, true), stamped(2, 30)])!;
    expect(d.total).toBe(1);
    expect(d.clusters[0].firstId).toBe(2);
  });

  it("spans 0:00 to the last stamp and lands each stamp in its bucket", () => {
    // Stamps at 0s and 799s over 40 buckets: span 800, bucket width 20 s.
    const d = commentDensity([stamped(1, 0), stamped(2, 799), stamped(3, 410)], 40)!;
    expect(d.axisEnd).toBe(799);
    expect(d.bars).toHaveLength(40);
    expect(d.bars[0]).toBe(1); // 0 s → first bucket
    expect(d.bars[20]).toBe(1); // 410 s / 20 → bucket 20
    expect(d.bars[39]).toBe(1); // the last stamp lands in the last bucket
    expect(d.maxCount).toBe(1);
    expect(d.total).toBe(3);
  });

  it("merges adjacent busy buckets into one cluster, splits across gaps", () => {
    // Buckets of 20 s (span 800): stamps in buckets 0, 1 (adjacent) and 30.
    const d = commentDensity(
      [stamped(1, 5), stamped(2, 10), stamped(3, 25), stamped(4, 610), stamped(5, 799)],
      40,
    )!;
    expect(d.clusters).toHaveLength(3);
    const [a, b] = d.clusters;
    // First cluster covers buckets 0–1: two comments at 5/10 s + one at 25 s.
    expect(a.count).toBe(3);
    expect(a.startPct).toBe(0);
    expect(a.widthPct).toBe(5); // 2 of 40 buckets
    expect(b.count).toBe(1);
    expect(b.startPct).toBeCloseTo(75); // bucket 30 of 40
  });

  it("targets the cluster's earliest comment and labels it from the busiest bucket", () => {
    // Bucket width 20 s: ids 9/2 share bucket 0 (9 has the earlier stamp);
    // bucket 1 holds three comments and is the peak.
    const d = commentDensity(
      [stamped(9, 2), stamped(2, 12), stamped(3, 21), stamped(4, 22), stamped(5, 23), stamped(6, 799)],
      40,
    )!;
    const cluster = d.clusters[0];
    expect(cluster.firstId).toBe(9); // earliest stamp wins, not lowest id
    expect(cluster.peakSeconds).toBe(21); // a real stamp from the peak bucket
    expect(cluster.count).toBe(5);
  });

  it("survives every stamp sitting at 0:00", () => {
    const d = commentDensity([stamped(1, 0), stamped(2, 0)])!;
    expect(d.axisEnd).toBe(0);
    expect(d.bars[0]).toBe(2);
    expect(d.clusters).toHaveLength(1);
  });
});

describe("threadVelocity", () => {
  const now = Date.parse("2026-07-09T21:00:00Z");
  const ago = (minutes: number, deleted = false) => ({
    created_at: new Date(now - minutes * 60_000).toISOString(),
    deleted,
  });

  it("is null while the room isn't really moving (< 3 in the window)", () => {
    expect(threadVelocity([], now)).toBeNull();
    expect(threadVelocity([ago(1), ago(2)], now)).toBeNull();
  });

  it("rates comments inside the 15-minute window only, skipping deleted", () => {
    // 6 live in-window, one deleted and one 20-minutes-old excluded.
    const comments = [ago(1), ago(2), ago(3), ago(5), ago(8), ago(14), ago(4, true), ago(20)];
    expect(threadVelocity(comments, now)).toBeCloseTo(6 / 15);
  });

  it("shortens the span when the loaded pages don't cover the window", () => {
    const comments = [ago(1), ago(2), ago(3), ago(5)];
    // Untruncated: the thread only has these — rate over the full window.
    expect(threadVelocity(comments, now)).toBeCloseTo(4 / 15);
    // Truncated: older pages exist, the oldest loaded is 5 min old — the
    // window isn't covered, so rate over the covered 5 minutes.
    expect(threadVelocity(comments, now, { truncated: true })).toBeCloseTo(4 / 5);
  });

  it("tolerates clock skew (created_at slightly in the future)", () => {
    expect(threadVelocity([ago(-1), ago(1), ago(2)], now)).toBeCloseTo(3 / 15);
  });
});

describe("velocityLabel", () => {
  it("keeps a decimal under 10/min, rounds above", () => {
    expect(velocityLabel(0.4)).toBe("0.4/min");
    expect(velocityLabel(3.24)).toBe("3.2/min");
    expect(velocityLabel(12.4)).toBe("12/min");
  });
});

describe("withinLiveWindow", () => {
  const now = Date.parse("2026-07-09T21:00:00Z");

  it("is true only within ~24 h after airing", () => {
    expect(withinLiveWindow(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(withinLiveWindow(new Date(now - LIVE_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(withinLiveWindow(new Date(now - LIVE_WINDOW_MS - 1).toISOString(), now)).toBe(false);
  });

  it("is false for upcoming, undated, and unparseable airing times", () => {
    expect(withinLiveWindow(new Date(now + 60_000).toISOString(), now)).toBe(false);
    expect(withinLiveWindow(null, now)).toBe(false);
    expect(withinLiveWindow(undefined, now)).toBe(false);
    expect(withinLiveWindow("not-a-date", now)).toBe(false);
  });
});
