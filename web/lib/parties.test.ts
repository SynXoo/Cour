import { describe, expect, it } from "vitest";
import {
  EMPTY_ROOM,
  applyFrame,
  backoffMs,
  encodeFrame,
  errorCopy,
  parseFrame,
  presenceLabel,
  socketUrl,
  sortMembers,
  type PartyMember,
  type WatchParty,
} from "./parties";

const member = (id: number, username = `user${id}`): PartyMember => ({
  id,
  username,
  avatar_url: null,
});

const party: WatchParty = {
  id: 7,
  anime: {
    id: 1,
    slug: "show",
    title: "Show",
    title_english: null,
    cover_image: null,
    cover_color: null,
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: null,
    popularity: 0,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
  },
  episode: { number: 3, title: null, airing_at: null },
  host: { username: "host", avatar_url: null },
  visibility: "public",
  created_at: "2026-09-05T20:00:00Z",
  closed_at: null,
};

describe("frames", () => {
  it("round-trips the {op, data} envelope", () => {
    expect(parseFrame(encodeFrame("join", { party: 7 }))).toEqual({ op: "join", data: { party: 7 } });
    expect(parseFrame(encodeFrame("heartbeat"))).toEqual({ op: "heartbeat", data: {} });
  });

  it("rejects non-strings, bad JSON and frames without an op", () => {
    expect(parseFrame(new ArrayBuffer(2))).toBeNull();
    expect(parseFrame("{nope")).toBeNull();
    expect(parseFrame('{"data":{}}')).toBeNull();
    expect(parseFrame("null")).toBeNull();
  });

  it("builds the gateway url on the page's own origin", () => {
    expect(socketUrl({ protocol: "http:", host: "localhost:3100" })).toBe("ws://localhost:3100/api/v1/ws");
    expect(socketUrl({ protocol: "https:", host: "cour.app" })).toBe("wss://cour.app/api/v1/ws");
  });

  it("backs off exponentially to a 15 s cap", () => {
    expect([0, 1, 2, 3, 4, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    expect(backoffMs(-1)).toBe(1000);
  });
});

describe("applyFrame", () => {
  it("takes the state snapshot, deduped and host-first", () => {
    const room = applyFrame(EMPTY_ROOM, {
      op: "state",
      data: { party, members: [member(2, "zed"), member(1, "host"), member(2, "zed")] },
    });
    expect(room.party?.id).toBe(7);
    expect(room.members.map((m) => m.username)).toEqual(["host", "zed"]);
    expect(room.error).toBeNull();
  });

  it("adds a joiner once, keeps order, and drops a leaver", () => {
    const base = applyFrame(EMPTY_ROOM, { op: "state", data: { party, members: [member(1, "host")] } });
    const joined = applyFrame(base, { op: "member.joined", data: member(3, "amy") });
    expect(joined.members.map((m) => m.username)).toEqual(["host", "amy"]);
    // A repeat announcement (the snapshot raced the broadcast) is idempotent.
    const again = applyFrame(joined, { op: "member.joined", data: member(3, "amy") });
    expect(again.members).toHaveLength(2);
    const left = applyFrame(again, { op: "member.left", data: { id: 3 } });
    expect(left.members.map((m) => m.username)).toEqual(["host"]);
    // Leaving twice, or an unknown id, is a no-op that keeps the reference.
    expect(applyFrame(left, { op: "member.left", data: { id: 3 } })).toBe(left);
  });

  it("records join errors and clears them on the next state", () => {
    const errored = applyFrame(EMPTY_ROOM, { op: "error", data: { code: "forbidden", message: "no" } });
    expect(errored.error).toEqual({ code: "forbidden", message: "no" });
    const joined = applyFrame(errored, { op: "state", data: { party, members: [] } });
    expect(joined.error).toBeNull();
  });

  it("ignores hello, unknown ops and malformed payloads without re-rendering", () => {
    expect(applyFrame(EMPTY_ROOM, { op: "hello", data: { user_id: 1 } })).toBe(EMPTY_ROOM);
    expect(applyFrame(EMPTY_ROOM, { op: "clock", data: {} })).toBe(EMPTY_ROOM);
    expect(applyFrame(EMPTY_ROOM, { op: "state", data: { party } })).toBe(EMPTY_ROOM);
    expect(applyFrame(EMPTY_ROOM, { op: "member.joined", data: { username: "x" } })).toBe(EMPTY_ROOM);
  });
});

describe("copy", () => {
  it("sorts the host ahead of everyone regardless of name", () => {
    const sorted = sortMembers([member(1, "aaa"), member(2, "zed"), member(3, "mid")], "zed");
    expect(sorted.map((m) => m.username)).toEqual(["zed", "aaa", "mid"]);
  });

  it("phrases presence for the viewer", () => {
    expect(presenceLabel(0, false)).toBe("Nobody here yet");
    expect(presenceLabel(1, true)).toBe("Just you so far");
    expect(presenceLabel(1, false)).toBe("1 here");
    expect(presenceLabel(4, true)).toBe("4 here");
  });

  it("explains fatal join errors", () => {
    expect(errorCopy({ code: "forbidden", message: "" }, "rin")).toMatch(/@rin's followers and friends/);
    expect(errorCopy({ code: "conflict", message: "" }, null)).toMatch(/has ended/);
    expect(errorCopy({ code: "not_found", message: "" }, null)).toMatch(/doesn't exist/);
    expect(errorCopy({ code: "weird", message: "boom" }, null)).toBe("boom");
  });
});
