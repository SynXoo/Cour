package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"

	"cour/internal/parties"
)

// The watch-party gateway (docs/WATCH_PARTIES.md): one WebSocket per client,
// JSON frames {op, data} both ways. Presence is a Redis ZSET per party
// (member → last heartbeat) so any instance serves any room; room events fan
// out over the party: bus. Only state changes cross the wire.

// Party ops, client → server.
const (
	OpAuth      = "auth"
	OpJoin      = "join"
	OpLeave     = "leave"
	OpHeartbeat = "heartbeat"
)

// Party ops, server → client.
const (
	OpHello        = "hello"
	OpState        = "state"
	OpMemberJoined = "member.joined"
	OpMemberLeft   = "member.left"
	OpError        = "error"
)

// Error codes on the socket mirror the REST envelope's.
const (
	ErrCodeUnauthorized = "unauthorized"
	ErrCodeNotFound     = "not_found"
	ErrCodeForbidden    = "forbidden"
	ErrCodeBadRequest   = "bad_request"
	ErrCodeConflict     = "conflict"
	ErrCodeRateLimited  = "rate_limited"
	ErrCodeValidation   = "validation_failed"
)

const (
	partyBusPrefix = "party:"
	// A member whose heartbeat is older than this is swept from presence; the
	// client heartbeats every 15 s, so three misses.
	presenceTTL = 45 * time.Second
	// A socket that sends nothing (not even a heartbeat) for this long is
	// closed; the client's reconnect path re-joins.
	readTimeout = 60 * time.Second
	// A browser socket must authenticate with its first frame this quickly.
	authTimeout  = 5 * time.Second
	writeTimeout = 5 * time.Second
	pingEvery    = 30 * time.Second
	// Safety TTL on the presence key so an abandoned room's set can't leak
	// forever (M4.4's idle auto-close is the real lifecycle).
	presenceKeyTTL = 24 * time.Hour
	maxFrameBytes  = 16 << 10
)

// PartyUser is the authenticated socket owner.
type PartyUser struct {
	ID       int64
	Username string
}

// Authenticator turns a bearer token into a user (httpapi adapts the auth
// package's TokenIssuer).
type Authenticator func(token string) (PartyUser, bool)

// PartyGateway serves /ws. Construct with NewPartyGateway.
type PartyGateway struct {
	log     *slog.Logger
	rdb     *redis.Client
	bus     *Hub
	parties *parties.Service
	auth    Authenticator
	// toParty renders a party view as the wire DTO (kept in httpapi so this
	// package stays free of the generated API types).
	toParty func(parties.View) any
	origins []string
	now     func() time.Time

	limiter   *redis_rate.Limiter
	persister Persister  // optional: opt-in persistence into episode threads
	filter    TextFilter // optional: the language policy
}

func NewPartyGateway(rdb *redis.Client, svc *parties.Service, auth Authenticator, toParty func(parties.View) any, origins []string, log *slog.Logger) *PartyGateway {
	return &PartyGateway{
		log:     log,
		rdb:     rdb,
		bus:     NewBus(rdb, log, partyBusPrefix),
		parties: svc,
		auth:    auth,
		toParty: toParty,
		origins: origins,
		now:     time.Now,
		limiter: redis_rate.NewLimiter(rdb),
	}
}

// Close releases the bus subscription.
func (g *PartyGateway) Close() error { return g.bus.Close() }

// Frame is the wire envelope in both directions.
type Frame struct {
	Op   string          `json:"op"`
	Data json.RawMessage `json:"data,omitempty"`
}

type partyMember struct {
	ID        int64   `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatar_url"`
}

type memberLeft struct {
	ID int64 `json:"id"`
}

type helloPayload struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
}

type errorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type joinRequest struct {
	Party int64 `json:"party"`
}

type authRequest struct {
	Token string `json:"token"`
}

// Serve upgrades the request and runs the socket until the client goes away.
// pre is the identity from a bearer header on the upgrade request (nil for a
// browser, which authenticates with its first frame).
func (g *PartyGateway) Serve(w http.ResponseWriter, r *http.Request, pre *PartyUser) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: g.origins})
	if err != nil {
		// Accept has already written the HTTP error (bad origin, no upgrade).
		g.log.Debug("party ws: accept", "err", err)
		return
	}
	c.SetReadLimit(maxFrameBytes)

	s := &session{g: g, c: c}
	defer s.teardown()

	ctx := r.Context()
	if pre != nil {
		s.user = *pre
	} else if !s.authenticate(ctx) {
		return
	}
	s.send(ctx, OpHello, helloPayload{UserID: s.user.ID, Username: s.user.Username})

	go s.keepalive(ctx)
	s.loop(ctx)
}

// session is one connected socket: its user and, once joined, its party.
type session struct {
	g    *PartyGateway
	c    *websocket.Conn
	user PartyUser

	mu      sync.Mutex
	partyID int64
	cleanup func()
	// Set on join, read by the clock ops, chat, and the sync loop.
	isHost   bool
	duration *int
	stopSync chan struct{}
	view     parties.View
	avatar   *string
}

// authenticate waits for the first frame, which must be an auth op carrying a
// valid access token. Anything else closes the socket.
func (s *session) authenticate(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, authTimeout)
	defer cancel()
	var f Frame
	if err := wsjson.Read(ctx, s.c, &f); err != nil {
		_ = s.c.Close(websocket.StatusPolicyViolation, "auth required")
		return false
	}
	var req authRequest
	if f.Op != OpAuth || json.Unmarshal(f.Data, &req) != nil || req.Token == "" {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeUnauthorized, Message: "first frame must be auth"})
		_ = s.c.Close(websocket.StatusPolicyViolation, "auth required")
		return false
	}
	user, ok := s.g.auth(req.Token)
	if !ok {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeUnauthorized, Message: "invalid or expired token"})
		_ = s.c.Close(websocket.StatusPolicyViolation, "unauthorized")
		return false
	}
	s.user = user
	return true
}

// loop reads frames until the client disconnects or falls silent.
func (s *session) loop(ctx context.Context) {
	for {
		readCtx, cancel := context.WithTimeout(ctx, readTimeout)
		var f Frame
		err := wsjson.Read(readCtx, s.c, &f)
		cancel()
		if err != nil {
			switch {
			case websocket.CloseStatus(err) != -1, errors.Is(err, context.Canceled):
				// Clean close or the request context ending: nothing to log.
			case errors.Is(err, context.DeadlineExceeded):
				_ = s.c.Close(websocket.StatusPolicyViolation, "heartbeat timeout")
			default:
				s.g.log.Debug("party ws: read", "user_id", s.user.ID, "err", err)
			}
			return
		}
		s.handle(ctx, f)
	}
}

func (s *session) handle(ctx context.Context, f Frame) {
	switch f.Op {
	case OpJoin:
		var req joinRequest
		if json.Unmarshal(f.Data, &req) != nil || req.Party <= 0 {
			s.send(ctx, OpError, errorPayload{Code: ErrCodeBadRequest, Message: "join needs a party id"})
			return
		}
		s.join(ctx, req.Party)
	case OpLeave:
		s.leave(ctx)
	case OpHeartbeat:
		s.heartbeat(ctx)
	case OpPlay, OpPause, OpSeek:
		var req clockRequest
		if json.Unmarshal(f.Data, &req) != nil || (f.Op == OpSeek && req.Position == nil) {
			s.send(ctx, OpError, errorPayload{Code: ErrCodeBadRequest, Message: f.Op + " needs a numeric position"})
			return
		}
		s.clockOp(ctx, f.Op, req.Position)
	case OpChat:
		var req chatRequest
		if json.Unmarshal(f.Data, &req) != nil {
			s.send(ctx, OpError, errorPayload{Code: ErrCodeBadRequest, Message: "chat needs a body"})
			return
		}
		s.chat(ctx, req)
	case OpReact:
		var req reactRequest
		if json.Unmarshal(f.Data, &req) != nil {
			s.send(ctx, OpError, errorPayload{Code: ErrCodeBadRequest, Message: "react needs an emoji"})
			return
		}
		s.react(ctx, req)
	case OpAuth:
		// Already authenticated; a stray auth frame is harmless.
	default:
		s.send(ctx, OpError, errorPayload{Code: ErrCodeBadRequest, Message: fmt.Sprintf("unknown op %q", f.Op)})
	}
}

// join gates on visibility + open state, subscribes to the room's bus before
// snapshotting presence (so nothing arriving in between is lost — the client
// dedupes by member id), then announces the newcomer to every instance.
func (s *session) join(ctx context.Context, partyID int64) {
	v, err := s.g.parties.Joinable(ctx, s.user.ID, partyID)
	if err != nil {
		s.send(ctx, OpError, joinError(err))
		return
	}

	s.leave(ctx)

	s.mu.Lock()
	s.partyID = partyID
	events, cleanup := s.g.bus.Subscribe(partyID)
	s.cleanup = cleanup
	s.isHost = v.Party.HostID == s.user.ID
	s.duration = durationSeconds(v.Anime.DurationMin)
	s.view = v
	s.stopSync = make(chan struct{})
	stopSync := s.stopSync
	s.mu.Unlock()
	go s.forward(ctx, events)
	go s.syncLoop(ctx, partyID, stopSync)

	added, ids, err := s.g.touchPresence(ctx, partyID, s.user.ID)
	if err != nil {
		s.g.log.Warn("party ws: presence", "party_id", partyID, "err", err)
	}
	members, err := s.g.parties.Members(ctx, ids)
	if err != nil {
		s.g.log.Warn("party ws: members", "party_id", partyID, "err", err)
		members = nil
	}
	wire := make([]partyMember, 0, len(members))
	for _, m := range members {
		wire = append(wire, partyMember{ID: m.ID, Username: m.Username, AvatarURL: m.AvatarURL})
		if m.ID == s.user.ID {
			s.mu.Lock()
			s.avatar = m.AvatarURL
			s.mu.Unlock()
		}
	}
	clock, err := s.g.loadClock(ctx, partyID, s.duration)
	if err != nil {
		s.g.log.Warn("party ws: clock", "party_id", partyID, "err", err)
	}
	chat, err := s.g.backlog(ctx, partyID)
	if err != nil {
		s.g.log.Warn("party ws: backlog", "party_id", partyID, "err", err)
		chat = []Message{}
	}
	s.send(ctx, OpState, map[string]any{
		"party":   s.g.toParty(v),
		"members": wire,
		"clock":   clock.synced(s.g.now()),
		"chat":    chat,
	})

	if added {
		s.g.bus.Publish(ctx, partyID, Encode(OpMemberJoined, s.self(members)))
	}
}

// self is this user's member row, from the hydrated list when present.
func (s *session) self(members []parties.Member) partyMember {
	for _, m := range members {
		if m.ID == s.user.ID {
			return partyMember{ID: m.ID, Username: m.Username, AvatarURL: m.AvatarURL}
		}
	}
	return partyMember{ID: s.user.ID, Username: s.user.Username}
}

func joinError(err error) errorPayload {
	switch {
	case errors.Is(err, parties.ErrNotFound):
		return errorPayload{Code: ErrCodeNotFound, Message: "party not found"}
	case errors.Is(err, parties.ErrForbidden):
		return errorPayload{Code: ErrCodeForbidden, Message: "this party is not open to you"}
	case errors.Is(err, parties.ErrClosed):
		return errorPayload{Code: ErrCodeConflict, Message: "this party has ended"}
	}
	return errorPayload{Code: "internal_error", Message: "could not join"}
}

// leave drops the room subscription and this user's presence, announcing the
// departure. Safe to call when not in a room. Runs on a detached context so
// a disconnect (request context already done) still cleans up.
func (s *session) leave(ctx context.Context) {
	s.mu.Lock()
	partyID := s.partyID
	cleanup := s.cleanup
	stopSync := s.stopSync
	s.partyID, s.cleanup, s.stopSync = 0, nil, nil
	s.isHost, s.duration, s.view, s.avatar = false, nil, parties.View{}, nil
	s.mu.Unlock()
	if partyID == 0 {
		return
	}
	close(stopSync)
	cleanup()

	bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), writeTimeout)
	defer cancel()
	removed, err := s.g.rdb.ZRem(bg, presenceKey(partyID), memberField(s.user.ID)).Result()
	if err != nil {
		s.g.log.Warn("party ws: zrem", "party_id", partyID, "err", err)
	}
	if removed > 0 {
		s.g.bus.Publish(bg, partyID, Encode(OpMemberLeft, memberLeft{ID: s.user.ID}))
	}
}

// heartbeat refreshes this member's presence; a member who had been swept
// (e.g. a laptop lid closed for a minute) is re-announced.
func (s *session) heartbeat(ctx context.Context) {
	s.mu.Lock()
	partyID := s.partyID
	s.mu.Unlock()
	if partyID == 0 {
		return
	}
	added, _, err := s.g.touchPresence(ctx, partyID, s.user.ID)
	if err != nil {
		s.g.log.Warn("party ws: heartbeat", "party_id", partyID, "err", err)
		return
	}
	if added {
		s.g.bus.Publish(ctx, partyID, Encode(OpMemberJoined, partyMember{ID: s.user.ID, Username: s.user.Username}))
	}
}

// forward relays bus events for the joined room to the socket until leave's
// cleanup closes the channel. A member's own presence echo is dropped: the
// joiner already holds itself in the state snapshot, and a second tab's
// leave must not tell the first tab it is gone.
func (s *session) forward(ctx context.Context, events <-chan Event) {
	for ev := range events {
		if s.isSelfEcho(ev) {
			continue
		}
		s.send(ctx, ev.Name, ev.Data)
	}
}

func (s *session) isSelfEcho(ev Event) bool {
	if ev.Name != OpMemberJoined && ev.Name != OpMemberLeft {
		return false
	}
	var who struct {
		ID int64 `json:"id"`
	}
	return json.Unmarshal(ev.Data, &who) == nil && who.ID == s.user.ID
}

// keepalive pings the peer so half-open connections surface as errors.
func (s *session) keepalive(ctx context.Context) {
	t := time.NewTicker(pingEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := s.c.Ping(pctx)
			cancel()
			if err != nil {
				_ = s.c.Close(websocket.StatusGoingAway, "ping failed")
				return
			}
		}
	}
}

// send writes one frame; write errors end the socket via the read loop.
// Bus events and socket frames share op names on purpose, so an Event's
// name is the op.
func (s *session) send(ctx context.Context, op string, data any) {
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), writeTimeout)
	defer cancel()
	if err := wsjson.Write(wctx, s.c, Frame{Op: op, Data: marshal(data)}); err != nil {
		s.g.log.Debug("party ws: write", "op", op, "err", err)
	}
}

func (s *session) teardown() {
	s.leave(context.Background())
	_ = s.c.CloseNow()
}

func marshal(v any) json.RawMessage {
	if raw, ok := v.(json.RawMessage); ok {
		return raw
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return raw
}

// ── Shared clock ───────────────────────────────────────────────────────────

// clockOp applies a host's play/pause/seek: load the anchor, transform it,
// persist, and broadcast the new anchor to every instance as `clock`.
func (s *session) clockOp(ctx context.Context, op string, position *float64) {
	s.mu.Lock()
	partyID, isHost, duration := s.partyID, s.isHost, s.duration
	s.mu.Unlock()
	if partyID == 0 {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeBadRequest, Message: "join a party first"})
		return
	}
	if !isHost {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeForbidden, Message: "only the host controls the clock"})
		return
	}
	c, err := s.g.loadClock(ctx, partyID, duration)
	if err != nil {
		s.g.log.Warn("party ws: clock load", "party_id", partyID, "err", err)
		s.send(ctx, OpError, errorPayload{Code: "internal_error", Message: "clock unavailable"})
		return
	}
	now := s.g.now()
	switch op {
	case OpPlay:
		c = c.play(now, position)
	case OpPause:
		c = c.pause(now, position)
	case OpSeek:
		c = c.seek(now, *position)
	}
	if err := s.g.saveClock(ctx, partyID, c); err != nil {
		s.g.log.Warn("party ws: clock save", "party_id", partyID, "err", err)
		s.send(ctx, OpError, errorPayload{Code: "internal_error", Message: "clock unavailable"})
		return
	}
	s.g.bus.Publish(ctx, partyID, Encode(OpClock, c))
}

// syncLoop re-sends this socket the current anchor every 30 s so the
// client's interpolation can't drift, until leave closes stop.
func (s *session) syncLoop(ctx context.Context, partyID int64, stop <-chan struct{}) {
	t := time.NewTicker(syncEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-stop:
			return
		case <-t.C:
			s.mu.Lock()
			duration := s.duration
			s.mu.Unlock()
			c, err := s.g.loadClock(ctx, partyID, duration)
			if err != nil {
				continue
			}
			s.send(ctx, OpSync, c.synced(s.g.now()))
		}
	}
}

// ── Live chat + reactions ──────────────────────────────────────────────────

// chat validates, rate-limits and broadcasts a message; with persist it also
// becomes a comment in the episode thread, anchored to the clock when the
// clock has moved.
func (s *session) chat(ctx context.Context, req chatRequest) {
	body, ok := validateChat(req.Body)
	if !ok {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeValidation, Message: fmt.Sprintf("chat must be 1-%d characters", maxChatBody)})
		return
	}
	if s.g.filter != nil && s.g.filter.Flagged(body) {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeValidation, Message: "violates the language policy"})
		return
	}
	m := Message{Kind: KindChat, Body: &body}
	if req.Persist {
		// A chat line is anchored only once the clock has moved; before the
		// party starts it is a plain comment.
		if pos := s.clockPosition(ctx); pos > 0 {
			m.Position = &pos
		}
	}
	s.publishMessage(ctx, m, req.Persist, body)
}

// react broadcasts a timestamped reaction; persisted, it is the emoji glyph
// as a timestamped comment.
func (s *session) react(ctx context.Context, req reactRequest) {
	g, ok := validEmojis[req.Emoji]
	if !ok {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeValidation, Message: "unknown emoji"})
		return
	}
	pos := s.clockPosition(ctx)
	if req.Position != nil && *req.Position >= 0 {
		pos = *req.Position
	}
	emoji := req.Emoji
	m := Message{Kind: KindReact, Emoji: &emoji, Position: &pos}
	s.publishMessage(ctx, m, req.Persist, g)
}

// publishMessage is the shared tail: room membership, rate limit, optional
// persistence, id, backlog, broadcast.
func (s *session) publishMessage(ctx context.Context, m Message, persist bool, persistedBody string) {
	s.mu.Lock()
	partyID, view, avatar := s.partyID, s.view, s.avatar
	s.mu.Unlock()
	if partyID == 0 {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeBadRequest, Message: "join a party first"})
		return
	}
	allowed, err := s.g.allowChat(ctx, s.user.ID)
	if err != nil {
		s.g.log.Warn("party ws: chat limiter", "err", err)
	} else if !allowed {
		s.send(ctx, OpError, errorPayload{Code: ErrCodeRateLimited, Message: "slow down a little"})
		return
	}

	m.From = partyMember{ID: s.user.ID, Username: s.user.Username, AvatarURL: avatar}
	m.At = s.g.now()

	if persist && s.g.persister != nil {
		id, err := s.g.persister.PersistComment(ctx, s.user.ID, view.Anime.ID, view.Episode.Number, persistedBody, m.Position)
		switch {
		case err == nil:
			m.CommentID = &id
		case errors.Is(err, ErrFlagged):
			s.send(ctx, OpError, errorPayload{Code: ErrCodeValidation, Message: "violates the language policy"})
			return
		default:
			// The live message still goes out; only the thread copy failed.
			s.g.log.Warn("party ws: persist", "party_id", partyID, "err", err)
		}
	}

	id, err := s.g.nextID(ctx, partyID)
	if err != nil {
		s.g.log.Warn("party ws: message id", "party_id", partyID, "err", err)
		id = m.At.UnixNano()
	}
	m.ID = id
	if err := s.g.appendBacklog(ctx, partyID, m); err != nil {
		s.g.log.Warn("party ws: backlog append", "party_id", partyID, "err", err)
	}
	s.g.bus.Publish(ctx, partyID, Encode(m.Kind, m))
}

// clockPosition is where the shared clock is right now (0 when unset).
func (s *session) clockPosition(ctx context.Context) float64 {
	s.mu.Lock()
	partyID, duration := s.partyID, s.duration
	s.mu.Unlock()
	if partyID == 0 {
		return 0
	}
	c, err := s.g.loadClock(ctx, partyID, duration)
	if err != nil {
		return 0
	}
	return c.positionAt(s.g.now())
}

// ── Presence (Redis ZSET: member → last heartbeat, unix seconds) ────────────

func presenceKey(partyID int64) string {
	return "party:" + strconv.FormatInt(partyID, 10) + ":members"
}

func memberField(userID int64) string { return strconv.FormatInt(userID, 10) }

// touchPresence records the user as present now, sweeps members whose
// heartbeat expired (announcing each departure), and returns whether the
// user was newly added plus the current member ids by last-seen order.
func (g *PartyGateway) touchPresence(ctx context.Context, partyID, userID int64) (added bool, ids []int64, err error) {
	key := presenceKey(partyID)
	now := g.now()
	n, err := g.rdb.ZAdd(ctx, key, redis.Z{Score: float64(now.Unix()), Member: memberField(userID)}).Result()
	if err != nil {
		return false, nil, err
	}
	added = n > 0
	_ = g.rdb.Expire(ctx, key, presenceKeyTTL).Err()

	cutoff := strconv.FormatInt(now.Add(-presenceTTL).Unix(), 10)
	stale, err := g.rdb.ZRangeArgs(ctx, redis.ZRangeArgs{Key: key, Start: "-inf", Stop: "(" + cutoff, ByScore: true}).Result()
	if err != nil {
		return added, nil, err
	}
	if len(stale) > 0 {
		members := make([]any, len(stale))
		for i, m := range stale {
			members[i] = m
		}
		if err := g.rdb.ZRem(ctx, key, members...).Err(); err != nil {
			return added, nil, err
		}
		for _, m := range stale {
			if id, perr := strconv.ParseInt(m, 10, 64); perr == nil {
				g.bus.Publish(ctx, partyID, Encode(OpMemberLeft, memberLeft{ID: id}))
			}
		}
	}

	raw, err := g.rdb.ZRange(ctx, key, 0, -1).Result()
	if err != nil {
		return added, nil, err
	}
	ids = make([]int64, 0, len(raw))
	for _, m := range raw {
		if id, perr := strconv.ParseInt(m, 10, 64); perr == nil {
			ids = append(ids, id)
		}
	}
	return added, ids, nil
}

// PresenceCount reports how many live members a room has (any instance).
// Discovery (M4.4) reads this for "N watching".
func (g *PartyGateway) PresenceCount(ctx context.Context, partyID int64) (int64, error) {
	cutoff := strconv.FormatInt(g.now().Add(-presenceTTL).Unix(), 10)
	return g.rdb.ZCount(ctx, presenceKey(partyID), cutoff, "+inf").Result()
}
