import type { components } from "@/lib/api/schema";

// Watch parties (docs/WATCH_PARTIES.md, M4). The pure half of the client:
// the wire protocol's shapes, the room reducer the socket hook folds frames
// into, and the small policies (heartbeat cadence, reconnect backoff) that
// the hook and its tests share.

export type WatchParty = components["schemas"]["WatchParty"];
export type PartyMember = components["schemas"]["PartyMember"];
export type PartyError = components["schemas"]["PartyError"];
export type PartyState = components["schemas"]["PartyState"];
export type PartyMemberLeft = components["schemas"]["PartyMemberLeft"];
export type PartyClock = components["schemas"]["PartyClock"];
export type PartyMessage = components["schemas"]["PartyMessage"];

/**
 * A clock anchor as the client holds it: the server's anchor plus the local
 * time it arrived. Interpolation uses the local receipt time, not the
 * server's `at`, so a skewed device clock can't throw the room off; the
 * 30 s `sync` re-anchors before drift matters.
 */
export type ClockAnchor = { clock: PartyClock; receivedAt: number };

/** One `{op, data}` envelope, either direction. */
export type PartyFrame = { op: string; data?: unknown };

/** The room as the view sees it: the party shell plus who is present. */
export type PartyRoom = {
  party: WatchParty | null;
  members: PartyMember[];
  /** The shared clock's latest anchor; null until the first state. */
  clock: ClockAnchor | null;
  /** Chat lines and reactions, oldest first; the backlog on join, then live. */
  chat: PartyMessage[];
  /** The last join-level error (not found / forbidden / ended); null when joined. */
  error: PartyError | null;
  /** A transient send-level error (rate limit, language policy); cleared by the next message. */
  notice: PartyError | null;
};

export const EMPTY_ROOM: PartyRoom = {
  party: null,
  members: [],
  clock: null,
  chat: [],
  error: null,
  notice: null,
};

/** Chat kept in memory per room; older lines fall off the top. */
export const CHAT_CAP = 200;
export const CHAT_MAX_LEN = 500;

/** Client heartbeat cadence; the server sweeps a member unseen for 45 s. */
export const HEARTBEAT_MS = 15_000;

/** Join errors that no reconnect can fix — the view explains instead. */
export const FATAL_CODES = new Set(["not_found", "forbidden", "conflict"]);

/**
 * Reconnect delay for the n-th consecutive failure: 1 s, 2 s, 4 s … capped at
 * 15 s. Deterministic (no jitter) — a single browser tab reconnecting to its
 * own room is not a thundering herd.
 */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 15_000);
}

/** The gateway rides the same-origin /api rewrite as everything else. */
export function socketUrl(loc: { protocol: string; host: string }): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/api/v1/ws`;
}

export function encodeFrame(op: string, data: unknown = {}): string {
  return JSON.stringify({ op, data });
}

export function parseFrame(raw: unknown): PartyFrame | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as { op?: unknown; data?: unknown };
    if (!v || typeof v.op !== "string") return null;
    return { op: v.op, data: v.data };
  } catch {
    return null;
  }
}

/** Host first, then by username — stable across state snapshots and joins. */
export function sortMembers(members: PartyMember[], hostUsername: string | null): PartyMember[] {
  return [...members].sort((a, b) => {
    const ah = a.username === hostUsername ? 0 : 1;
    const bh = b.username === hostUsername ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return a.username.localeCompare(b.username);
  });
}

function upsertMember(members: PartyMember[], m: PartyMember): PartyMember[] {
  const i = members.findIndex((x) => x.id === m.id);
  if (i === -1) return [...members, m];
  const next = [...members];
  next[i] = m;
  return next;
}

/**
 * Fold one server frame into the room. `state` replaces the snapshot and
 * clears any error; `member.joined` / `member.left` adjust presence by id
 * (idempotent — the server can announce a member the snapshot already held,
 * and a reconnect replays nothing it shouldn't); `error` records the join
 * failure. Unknown ops and `hello` leave the room untouched (same reference).
 */
export function applyFrame(room: PartyRoom, frame: PartyFrame, now = Date.now()): PartyRoom {
  switch (frame.op) {
    case "state": {
      const st = frame.data as PartyState;
      if (!st || !st.party || !Array.isArray(st.members)) return room;
      const seen = new Set<number>();
      const members = st.members.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      const clock = isClock(st.clock) ? { clock: st.clock, receivedAt: now } : room.clock;
      const chat = Array.isArray(st.chat) ? st.chat.filter(isMessage).slice(-CHAT_CAP) : room.chat;
      return {
        party: st.party,
        members: sortMembers(members, st.party.host.username),
        clock,
        chat,
        error: null,
        notice: null,
      };
    }
    case "chat":
    case "react": {
      const m = frame.data as PartyMessage;
      if (!isMessage(m) || room.chat.some((x) => x.id === m.id)) return room;
      return { ...room, chat: [...room.chat, m].slice(-CHAT_CAP), notice: null };
    }
    case "clock":
    case "sync": {
      const c = frame.data as PartyClock;
      if (!isClock(c)) return room;
      return { ...room, clock: { clock: c, receivedAt: now } };
    }
    case "member.joined": {
      const m = frame.data as PartyMember;
      if (!m || typeof m.id !== "number") return room;
      return { ...room, members: sortMembers(upsertMember(room.members, m), room.party?.host.username ?? null) };
    }
    case "member.left": {
      const d = frame.data as PartyMemberLeft;
      if (!d || typeof d.id !== "number") return room;
      if (!room.members.some((m) => m.id === d.id)) return room;
      return { ...room, members: room.members.filter((m) => m.id !== d.id) };
    }
    case "party.closed": {
      if (!room.party || room.party.closed_at != null) return room;
      return { ...room, party: { ...room.party, closed_at: new Date(now).toISOString() } };
    }
    case "error": {
      const e = frame.data as PartyError;
      if (!e || typeof e.code !== "string") return room;
      const err = { code: e.code, message: e.message ?? "" };
      // Join-level failures own the page; anything else is a send that
      // bounced (rate limit, language policy, bad payload) and only needs
      // a line under the composer.
      return FATAL_CODES.has(e.code) || e.code === "unauthorized"
        ? { ...room, error: err }
        : { ...room, notice: err };
    }
    default:
      return room;
  }
}

/** "You're watching alone" / "2 here" / "5 here" — the presence line. */
export function presenceLabel(count: number, includesViewer: boolean): string {
  if (count <= 0) return "Nobody here yet";
  if (count === 1) return includesViewer ? "Just you so far" : "1 here";
  return `${count} here`;
}

/** Plain-language explanation for a fatal join error. */
export function errorCopy(error: PartyError, hostUsername: string | null): string {
  switch (error.code) {
    case "not_found":
      return "This party doesn't exist — the link may be wrong, or the room was never opened.";
    case "forbidden":
      return hostUsername
        ? `This party is open to @${hostUsername}'s followers and friends. Follow them and try again.`
        : "This party is open to the host's followers and friends.";
    case "conflict":
      return "This party has ended. The episode thread keeps the conversation going.";
    default:
      return error.message || "Couldn't join this party.";
  }
}

function isClock(v: unknown): v is PartyClock {
  const c = v as PartyClock | null;
  return !!c && typeof c.position === "number" && typeof c.playing === "boolean";
}

/** Where the shared clock is right now, in seconds, interpolated locally. */
export function positionAt(anchor: ClockAnchor, now = Date.now()): number {
  const { clock, receivedAt } = anchor;
  let p = clock.position;
  if (clock.playing) p += Math.max(0, now - receivedAt) / 1000;
  if (p < 0) p = 0;
  if (clock.duration != null && p > clock.duration) p = clock.duration;
  return p;
}

/** `m:ss`, or `h:mm:ss` past an hour — the stopwatch readout. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/**
 * Parse a jump target typed by the host: `12:34`, `1:02:03`, or bare
 * seconds. Null when it isn't a time.
 */
export function parseClockInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

function isMessage(v: unknown): v is PartyMessage {
  const m = v as PartyMessage | null;
  return (
    !!m &&
    typeof m.id === "number" &&
    (m.kind === "chat" || m.kind === "react") &&
    !!m.from &&
    typeof m.from.username === "string"
  );
}
