# Phase 2 — real-time watch parties

Phase 1 ships the *asynchronous* watching-along ritual (episode threads,
timestamped comments). Phase 2 makes it synchronous: **rooms where a group
watches the same episode at the same time**, with a shared playback clock,
live chat, and live timestamped reactions.

**Hard constraint carried over from Phase 1:** Cour never hosts, streams,
proxies, or links to video. A watch party synchronizes *people* — a shared
timer, presence, and chat. Every participant supplies their own legal
source. This is a product guarantee, not an implementation detail.

---

## What Phase 1 already put in place (the seams)

| Seam | Where | How Phase 2 uses it |
|---|---|---|
| Moment anchors | `comments.timestamp_seconds` | A live reaction at 12:34 is the same shape as an async timestamped comment. Parties write reactions into the episode's existing thread — after the party ends, the thread *is* the VOD-style record. |
| Episode threads | `threads (kind = 'episode')`, get-or-create | Every party binds to an episode thread; chat that deserves to persist lands there. |
| Redis pub/sub client + patterns | `go-redis` already in the stack; asynq uses the same Redis | Room events fan out over pub/sub channels; any API instance can host any socket. |
| Async job spine | asynq worker | Party lifecycle jobs (auto-close idle rooms, persist summaries). |
| Auth | short-lived Ed25519 JWTs | The WS handshake reuses bearer tokens — no new auth surface. Multi-instance safe because signing keys are shared via `AUTH_TOKEN_SEED`. |
| Package boundary | `backend/internal/realtime` (stub) | The gateway grows here without touching existing domains. |
| Feature flag | `FEATURE_WATCH_PARTIES` | Ship dark, enable per environment. |

---

## Architecture

```
browser ⇄ WSS ⇄ API instance (any)          Redis
              gorilla/nhooyr websocket   pub/sub: room:{id}:events
              per-room goroutine hub  ⇄  presence: room:{id}:members (ZSET, TTL heartbeats)
                                         state:   room:{id}:clock (playback state)
                                         Postgres: rooms table (durable metadata)
```

- **Gateway**: one WebSocket endpoint (`/api/v1/ws`), JWT on handshake.
  Each API instance keeps in-memory hubs only for rooms with local sockets;
  cross-instance delivery rides `PUBLISH room:{id}:events`. This is the
  standard horizontal-scaling shape — no sticky sessions required.
- **Presence**: `ZADD room:{id}:members <now> <user>` heartbeats every 15 s;
  members with scores older than 45 s are swept. Cheap, self-healing.
- **Shared clock**: the room state is `{episode_id, position_seconds,
  playing, updated_at, host_id}` in a Redis hash. The host's client emits
  `play/pause/seek(position)`; the server rebroadcasts and persists the new
  anchor. Clients render `position = anchor + (now − updated_at)` while
  playing — only *state changes* cross the wire (no per-second na streaming),
  so drift correction is client-side interpolation plus an occasional
  `sync` broadcast (every 30 s).
- **Live events**: chat messages and timestamped reactions are room events;
  reactions optionally persist as timestamped comments (author opt-in flag),
  which is how a party enriches the async thread rather than competing with
  it.

## Data model additions

```sql
CREATE TABLE rooms (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  episode_id BIGINT NOT NULL REFERENCES episodes(id),
  host_id BIGINT NOT NULL REFERENCES users(id),
  visibility room_visibility NOT NULL DEFAULT 'followers', -- public|followers|invite
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
```
Live state stays in Redis (rooms are ephemeral); Postgres keeps the shell
for history ("watched with 6 others") and moderation.

## Protocol sketch (client ⇄ server)

```
→ {op:"join", room:123}
← {op:"state", clock:{...}, members:[...]}
→ {op:"chat", body:"here we go"}
← {op:"chat", from:"rin_ttgl", body:"here we go"}
→ {op:"seek", position:754}            (host only)
← {op:"clock", position:754, playing:true, at:"..."}
→ {op:"react", position:754, emoji:"fire", persist:true}
← {op:"react", from:"rin_ttgl", position:754, emoji:"fire"}
← {op:"sync", clock:{...}}             (periodic)
```

## Delivery plan

1. Gateway + presence (join/leave/heartbeat), flag-gated.
2. Shared clock (host controls, drift correction).
3. Live chat + reactions; persistence into episode threads.
4. Room lifecycle: creation from any episode page, discovery of public
   rooms on the schedule page ("3 rooms watching tonight"), idle auto-close
   via asynq.
5. Later: SSE fallback for notification push (the bell currently polls),
   riding the same pub/sub channels.

## Explicitly out of Phase 2

Voice/video, synchronized *playback control of streaming services* (no
DRM-adjacent integrations), federated rooms.
