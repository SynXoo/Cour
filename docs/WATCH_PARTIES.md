# Watch parties — design (Phase 2, milestone M4)

Phase 1 ships the *asynchronous* watching-along ritual (episode threads,
timestamped comments). This milestone makes it synchronous: **rooms where a
group watches the same episode at the same time**, with a shared playback
clock, live chat, and live timestamped reactions.

**Hard constraint carried over from Phase 1:** Cour never hosts, streams,
proxies, or links to video. A watch party synchronizes *people* — a shared
timer, presence, and chat. Every participant supplies their own legal
source. This is a product guarantee, not an implementation detail.

Where this sits in the roadmap — and how it builds on the live thread layer
(M2) — is in [PHASE_2.md](PHASE_2.md).

---

## What Phase 1 already put in place (the seams)

| Seam | Where | How parties use it |
|---|---|---|
| Moment anchors | `comments.timestamp_seconds` | A live reaction at 12:34 is the same shape as an async timestamped comment. Parties write reactions into the episode's existing thread — after the party ends, the thread *is* the VOD-style record. |
| Episode threads | `threads (kind = 'episode')`, get-or-create | Every party binds to an episode thread; chat that deserves to persist lands there. |
| Redis pub/sub client + patterns | `go-redis` already in the stack; asynq uses the same Redis | Room events fan out over pub/sub channels; any API instance can host any socket. |
| Async job spine | asynq worker | Party lifecycle jobs (auto-close idle rooms, persist summaries). |
| Auth | short-lived Ed25519 JWTs | The WS handshake reuses bearer tokens — no new auth surface. Multi-instance safe because signing keys are shared via `AUTH_TOKEN_SEED`. |
| Package boundary | `backend/internal/realtime` | The gateway grows here without touching existing domains (shared with the M2 SSE hub). |
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

- **Gateway**: one WebSocket endpoint (`/api/v1/ws`), JWT on handshake — a
  bearer header for server-side clients, or (browsers can't set headers on
  a socket handshake, and the token never rides the URL) a first frame
  `{op:"auth", data:{token}}` within 5 s. The socket rides the same
  `/api/*` Next rewrite as SSE: Next's router server proxies `Upgrade`
  requests for external rewrites (verified in `router-server.js`, dev and
  standalone), so no second origin and no CORS. Each API instance keeps
  in-memory hubs only for rooms with local sockets; cross-instance delivery
  rides `PUBLISH party:{id}` (the M2 hub generalised into a prefix-scoped
  bus, `realtime.NewBus`). This is the standard horizontal-scaling shape —
  no sticky sessions required.
- **Presence**: `ZADD party:{id}:members <now> <user>` heartbeats every 15 s;
  members with scores older than 45 s are swept (by whichever join or
  heartbeat touches the room next, announcing each `member.left`), a socket
  silent for 60 s is closed, and an explicit `leave` or a dropped socket
  removes the member immediately. A member's own presence echo is not
  forwarded to them (the joiner already holds itself in the `state`
  snapshot; a second tab's leave must not tell the first it is gone).
  Cheap, self-healing.
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
CREATE TABLE watch_parties (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  episode_id BIGINT NOT NULL REFERENCES episodes(id),
  host_id BIGINT NOT NULL REFERENCES users(id),
  visibility party_visibility NOT NULL DEFAULT 'followers', -- public|followers|invite
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
-- one open room per host; creating the next closes the previous in-tx
CREATE UNIQUE INDEX ... ON watch_parties (host_id) WHERE closed_at IS NULL;
```
Live state stays in Redis (rooms are ephemeral); Postgres keeps the shell
for history ("watched with 6 others") and moderation.

**Naming (decided in M4.1):** the table, package and routes are
`watch_parties` / `internal/parties` / `/parties`, not `rooms` — by the time
M4 started, "rooms" already meant the live *episode threads* everywhere in
the UI (the `/threads` hub is titled Rooms, the landing's "live rooms"
rail). A party is a room *inside* a room; giving it its own word keeps
both readable.

**Visibility (M4.1):** `public` — any signed-in user; `followers` — the
host's followers, plus friends (a friendship is stronger than a follow);
`invite` — the host's friends until explicit invites arrive with room
lifecycle (M4.4). The host always sees their own room. A room the viewer
can't see reads as 403 (never 404 — the id is real and the host may open
the door).

## Protocol sketch (client ⇄ server)

Every frame is `{op, data}` in both directions (settled in M4.1: one
envelope, so the server's bus events and socket frames share names and a
payload never has to be merged into the op object). Payload schemas live in
`openapi.yaml` under the hand-routed `partySocket` operation, so the typed
TS client sees them.

```
→ {op:"auth",  data:{token}}                       (first frame, browsers)
→ {op:"join",  data:{party:123}}
← {op:"hello", data:{user_id, username}}
← {op:"state", data:{party:{...}, members:[...]}}  (+ clock from M4.2)
← {op:"member.joined", data:{id, username, avatar_url}}
← {op:"member.left",   data:{id}}
→ {op:"heartbeat", data:{}}                        (every 15 s)
→ {op:"leave", data:{}}
← {op:"error", data:{code, message}}               (REST error codes)

— M4.2+ —
→ {op:"chat", data:{body:"here we go"}}
← {op:"chat", data:{from:"rin_ttgl", body:"here we go"}}
→ {op:"seek", data:{position:754}}                 (host only)
← {op:"clock", data:{position:754, playing:true, at:"..."}}
→ {op:"react", data:{position:754, emoji:"fire", persist:true}}
← {op:"react", data:{from:"rin_ttgl", position:754, emoji:"fire"}}
← {op:"sync", data:{clock:{...}}}                  (periodic)
```

## Delivery plan

1. Gateway + presence (join/leave/heartbeat), flag-gated. **Shipped (M4.1)** — plus the minimum REST to reach a room: `POST /parties`, `GET /parties/{id}`, `GET /features`, and the `/parties/{id}` page (roster + connection pill). Entry points on episode pages wait for step 4.
2. Shared clock (host controls, drift correction).
3. Live chat + reactions; persistence into episode threads.
4. Room lifecycle: creation from any episode page, discovery of public
   rooms on the schedule page ("3 rooms watching tonight"), idle auto-close
   via asynq.
5. Later: SSE fallback for notification push (the bell currently polls),
   riding the same pub/sub channels.

## Explicitly out of scope

Voice/video, synchronized *playback control of streaming services* (no
DRM-adjacent integrations), federated rooms.
