"use client";

import { useEffect, useState } from "react";
import { getAccessToken, refreshSession } from "@/lib/api/client";
import {
  EMPTY_ROOM,
  FATAL_CODES,
  HEARTBEAT_MS,
  applyFrame,
  backoffMs,
  encodeFrame,
  parseFrame,
  socketUrl,
  type PartyRoom,
} from "@/lib/parties";

export type PartyConnection =
  /** Socket opening, or joined and waiting for the first state snapshot. */
  | "connecting"
  /** Joined; presence is live. */
  | "live"
  /** The socket dropped; a retry is scheduled (presence may be stale). */
  | "reconnecting"
  /** Closed for good — the caller unmounted, or a fatal join error. */
  | "closed";

export type PartyHandle = {
  connection: PartyConnection;
  room: PartyRoom;
};

/**
 * Joins one watch party over the gateway socket (docs/WATCH_PARTIES.md) and
 * keeps the room state current: `auth` with the in-memory token as the first
 * frame, `join`, a heartbeat every 15 s, exponential-backoff reconnects that
 * re-join, and a session refresh before retrying after the server rejected
 * the token. Fatal join errors (not found / forbidden / ended) stop the
 * reconnect loop — the view explains them from `room.error`.
 */
export function useParty(partyId: number, enabled = true): PartyHandle {
  // One snapshot keyed by party id: switching parties reads as a fresh
  // "connecting" room on the very next render, without an effect having to
  // reset state synchronously (react-hooks/set-state-in-effect).
  const [snap, setSnap] = useState<Snapshot>({ id: partyId, connection: "connecting", room: EMPTY_ROOM });

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;

    const current = (s: Snapshot): Snapshot =>
      s.id === partyId ? s : { id: partyId, connection: "connecting", room: EMPTY_ROOM };
    const setConnection = (connection: PartyConnection) =>
      setSnap((s) => ({ ...current(s), connection }));
    const setRoom = (fn: (room: PartyRoom) => PartyRoom) =>
      setSnap((s) => {
        const c = current(s);
        const room = fn(c.room);
        return room === c.room && c === s ? s : { ...c, room };
      });

    let ws: WebSocket | null = null;
    let closedByUs = false;
    let attempt = 0;
    let needsRefresh = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const stopHeartbeat = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    };

    const scheduleRetry = () => {
      if (closedByUs) return;
      setConnection("reconnecting");
      retry = setTimeout(() => void connect(), backoffMs(attempt++));
    };

    const connect = async () => {
      if (closedByUs) return;
      if (needsRefresh) {
        needsRefresh = false;
        await refreshSession();
        if (closedByUs) return;
      }
      const token = getAccessToken();
      if (!token) {
        // No session to speak of — nothing to authenticate with. The view
        // gates on session status, so this is a race at most; try again
        // once the session hydrates.
        needsRefresh = true;
        scheduleRetry();
        return;
      }

      const socket = new WebSocket(socketUrl(window.location));
      ws = socket;

      socket.onopen = () => {
        socket.send(encodeFrame("auth", { token }));
        socket.send(encodeFrame("join", { party: partyId }));
        stopHeartbeat();
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(encodeFrame("heartbeat"));
        }, HEARTBEAT_MS);
      };

      socket.onmessage = (e: MessageEvent) => {
        const frame = parseFrame(e.data);
        if (!frame) return;
        if (frame.op === "state") {
          attempt = 0;
          setConnection("live");
        } else if (frame.op === "error") {
          const code = (frame.data as { code?: string } | undefined)?.code ?? "";
          if (code === "unauthorized") {
            // The token expired between reconnects; refresh before the retry
            // (the server closes the socket right after this frame).
            needsRefresh = true;
          } else if (FATAL_CODES.has(code)) {
            closedByUs = true;
            setConnection("closed");
            socket.close();
          }
        }
        setRoom((prev) => applyFrame(prev, frame));
      };

      socket.onclose = () => {
        stopHeartbeat();
        if (ws === socket) ws = null;
        scheduleRetry();
      };
      // onclose always follows onerror; nothing extra to do here.
      socket.onerror = () => {};
    };

    void connect();

    return () => {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      stopHeartbeat();
      ws?.close();
      ws = null;
    };
  }, [partyId, enabled]);

  if (snap.id !== partyId) return { connection: "connecting", room: EMPTY_ROOM };
  return { connection: snap.connection, room: snap.room };
}

type Snapshot = { id: number; connection: PartyConnection; room: PartyRoom };
