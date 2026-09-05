import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_MS } from "@/lib/parties";

const refreshSession = vi.fn(async () => null);
let token: string | null = "tok-1";
vi.mock("@/lib/api/client", () => ({
  getAccessToken: () => token,
  refreshSession: () => refreshSession(),
}));

import { useParty } from "./use-party";

// A scriptable stand-in for the browser's WebSocket: the test opens it,
// feeds it server frames, and drops it; the hook's outbound frames are
// captured in `sent`.
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(raw: string) {
    this.sent.push(raw);
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  // Test-side controls.
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(op: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ op, data }) });
  }
  drop() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  ops() {
    return this.sent.map((s) => (JSON.parse(s) as { op: string }).op);
  }
}

const party = {
  id: 7,
  anime: { id: 1, slug: "s", title: "Show", title_english: null },
  episode: { number: 1, title: null, airing_at: null },
  host: { username: "host", avatar_url: null },
  visibility: "public",
  created_at: "",
  closed_at: null,
};

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  token = "tok-1";
  refreshSession.mockClear();
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useParty", () => {
  it("authenticates with the first frame, joins, then heartbeats every 15 s", () => {
    const { result } = renderHook(() => useParty(7));
    expect(result.current.connection).toBe("connecting");
    const ws = latest();
    expect(ws.url).toMatch(/\/api\/v1\/ws$/);

    act(() => ws.open());
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([
      { op: "auth", data: { token: "tok-1" } },
      { op: "join", data: { party: 7 } },
    ]);

    act(() => ws.receive("hello", { user_id: 1, username: "me" }));
    expect(result.current.connection).toBe("connecting");
    act(() => ws.receive("state", { party, members: [{ id: 1, username: "host", avatar_url: null }] }));
    expect(result.current.connection).toBe("live");
    expect(result.current.room.members.map((m) => m.username)).toEqual(["host"]);

    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    expect(ws.ops().at(-1)).toBe("heartbeat");
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    });
    expect(ws.ops().filter((op) => op === "heartbeat")).toHaveLength(3);
  });

  it("folds presence frames into the room", () => {
    const { result } = renderHook(() => useParty(7));
    const ws = latest();
    act(() => {
      ws.open();
      ws.receive("state", { party, members: [{ id: 1, username: "host", avatar_url: null }] });
      ws.receive("member.joined", { id: 2, username: "amy", avatar_url: null });
    });
    expect(result.current.room.members.map((m) => m.username)).toEqual(["host", "amy"]);
    act(() => ws.receive("member.left", { id: 2 }));
    expect(result.current.room.members.map((m) => m.username)).toEqual(["host"]);
  });

  it("reconnects with backoff after a drop and re-joins", () => {
    const { result } = renderHook(() => useParty(7));
    const first = latest();
    act(() => {
      first.open();
      first.receive("state", { party, members: [] });
    });
    expect(result.current.connection).toBe("live");

    act(() => first.drop());
    expect(result.current.connection).toBe("reconnecting");
    expect(FakeSocket.instances).toHaveLength(1);

    // First retry after 1 s — a fresh socket that authenticates and joins again.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeSocket.instances).toHaveLength(2);
    const second = latest();
    act(() => second.open());
    expect(second.ops()).toEqual(["auth", "join"]);

    // Fails again before any state: the next wait doubles.
    act(() => second.drop());
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeSocket.instances).toHaveLength(3);

    // A successful join resets the backoff.
    const third = latest();
    act(() => {
      third.open();
      third.receive("state", { party, members: [] });
    });
    expect(result.current.connection).toBe("live");
    act(() => third.drop());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("refreshes the session before retrying after an unauthorized error", async () => {
    renderHook(() => useParty(7));
    const first = latest();
    act(() => {
      first.open();
      first.receive("error", { code: "unauthorized", message: "expired" });
      first.drop();
    });
    expect(refreshSession).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("stops for good on a fatal join error and exposes it", () => {
    const { result } = renderHook(() => useParty(7));
    const ws = latest();
    act(() => {
      ws.open();
      ws.receive("error", { code: "forbidden", message: "nope" });
    });
    expect(result.current.connection).toBe("closed");
    expect(result.current.room.error?.code).toBe("forbidden");
    expect(ws.readyState).toBe(FakeSocket.CLOSED);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("stops on party.closed and marks the room ended", () => {
    const { result } = renderHook(() => useParty(7));
    const ws = latest();
    act(() => {
      ws.open();
      ws.receive("state", { party, members: [] });
      ws.receive("party.closed", {});
    });
    expect(result.current.connection).toBe("closed");
    expect(result.current.room.party?.closed_at).not.toBeNull();
    act(() => ws.drop());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("sends host clock ops over the open socket and drops them while disconnected", () => {
    const { result } = renderHook(() => useParty(7));
    const ws = latest();
    // Before open: silently ignored (no socket to write to).
    act(() => result.current.controls.play());
    expect(ws.sent).toHaveLength(0);

    act(() => ws.open());
    act(() => {
      result.current.controls.play();
      result.current.controls.seek(754);
      result.current.controls.pause(700);
      result.current.controls.play(0);
    });
    expect(ws.sent.slice(2).map((s) => JSON.parse(s))).toEqual([
      { op: "play", data: {} },
      { op: "seek", data: { position: 754 } },
      { op: "pause", data: { position: 700 } },
      { op: "play", data: { position: 0 } },
    ]);

    act(() => ws.drop());
    act(() => result.current.controls.pause());
    expect(ws.sent).toHaveLength(6);
  });

  it("sends chat and reactions with the opt-in flag only when set", () => {
    const { result } = renderHook(() => useParty(7));
    const ws = latest();
    act(() => ws.open());
    act(() => {
      result.current.controls.chat("hi");
      result.current.controls.chat("keep this", true);
      result.current.controls.react("fire");
      result.current.controls.react("heart", 754, true);
    });
    expect(ws.sent.slice(2).map((s) => JSON.parse(s))).toEqual([
      { op: "chat", data: { body: "hi" } },
      { op: "chat", data: { body: "keep this", persist: true } },
      { op: "react", data: { emoji: "fire" } },
      { op: "react", data: { emoji: "heart", position: 754, persist: true } },
    ]);
  });

  it("folds clock and sync anchors into the room", () => {
    const { result } = renderHook(() => useParty(7));
    const ws = latest();
    act(() => {
      ws.open();
      ws.receive("state", { party, members: [], clock: { position: 0, playing: false, at: "x", duration: null } });
    });
    expect(result.current.room.clock?.clock.playing).toBe(false);
    act(() => ws.receive("clock", { position: 12, playing: true, at: "y", duration: 1440 }));
    expect(result.current.room.clock?.clock).toEqual({ position: 12, playing: true, at: "y", duration: 1440 });
  });

  it("closes the socket on unmount without reconnecting, and stays idle when disabled", () => {
    const { unmount } = renderHook(() => useParty(7));
    const ws = latest();
    act(() => ws.open());
    unmount();
    expect(ws.readyState).toBe(FakeSocket.CLOSED);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.instances = [];
    renderHook(() => useParty(7, false));
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
