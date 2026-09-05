//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/config"
	"cour/internal/httpapi"
	"cour/internal/jobs"
	"cour/internal/parties"
)

// wsFrame is one {op, data} envelope off the party socket.
type wsFrame struct {
	Op   string          `json:"op"`
	Data json.RawMessage `json:"data"`
}

// partySocket is a test client speaking the watch-party protocol.
type partySocket struct {
	t      *testing.T
	c      *websocket.Conn
	frames chan wsFrame
	cancel context.CancelFunc
}

// dialParty opens /ws. With header=true the bearer token rides the upgrade
// request (server-side clients); otherwise the browser path is exercised —
// an anonymous upgrade followed by a first-frame auth op.
func dialParty(t *testing.T, token string, header bool) *partySocket {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	url := "ws" + strings.TrimPrefix(testServer.URL, "http") + "/api/v1/ws"
	opts := &websocket.DialOptions{HTTPHeader: http.Header{}}
	if header {
		opts.HTTPHeader.Set("Authorization", "Bearer "+token)
	}
	c, resp, err := websocket.Dial(ctx, url, opts) //nolint:bodyclose // the websocket owns the upgrade response
	if err != nil {
		cancel()
		t.Fatalf("dial ws: %v", err)
	}
	require.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)

	s := &partySocket{t: t, c: c, frames: make(chan wsFrame, 64), cancel: cancel}
	go s.read(ctx)
	if !header {
		s.send("auth", map[string]any{"token": token})
	}
	return s
}

func (s *partySocket) read(ctx context.Context) {
	for {
		var f wsFrame
		if err := wsjson.Read(ctx, s.c, &f); err != nil {
			close(s.frames)
			return
		}
		select {
		case s.frames <- f:
		case <-ctx.Done():
			return
		}
	}
}

func (s *partySocket) send(op string, data any) {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	require.NoError(s.t, wsjson.Write(ctx, s.c, map[string]any{"op": op, "data": data}))
}

// waitFor returns the next frame with the given op, discarding others.
func (s *partySocket) waitFor(op string, timeout time.Duration) wsFrame {
	s.t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case f, ok := <-s.frames:
			if !ok {
				s.t.Fatalf("socket closed while waiting for %q", op)
			}
			if f.Op == op {
				return f
			}
		case <-deadline:
			s.t.Fatalf("timed out waiting for %q frame", op)
		}
	}
}

// expectNone fails if a frame with the op arrives within the window.
func (s *partySocket) expectNone(op string, within time.Duration) {
	s.t.Helper()
	deadline := time.After(within)
	for {
		select {
		case f, ok := <-s.frames:
			if !ok {
				return
			}
			if f.Op == op {
				s.t.Fatalf("unexpected %q frame: %s", op, f.Data)
			}
		case <-deadline:
			return
		}
	}
}

// closed reports whether the server ended the socket (read loop finished).
func (s *partySocket) closed(within time.Duration) bool {
	deadline := time.After(within)
	for {
		select {
		case _, ok := <-s.frames:
			if !ok {
				return true
			}
		case <-deadline:
			return false
		}
	}
}

func (s *partySocket) close() {
	_ = s.c.Close(websocket.StatusNormalClosure, "bye")
	s.cancel()
}

type wsMember struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type wsState struct {
	Party struct {
		ID       int64   `json:"id"`
		ClosedAt *string `json:"closed_at"`
		Host     struct {
			Username string `json:"username"`
		} `json:"host"`
	} `json:"party"`
	Members []wsMember `json:"members"`
}

func decodeState(t *testing.T, f wsFrame) wsState {
	t.Helper()
	var st wsState
	require.NoError(t, json.Unmarshal(f.Data, &st))
	return st
}

func usernames(members []wsMember) []string {
	out := make([]string, 0, len(members))
	for _, m := range members {
		out = append(out, m.Username)
	}
	return out
}

func errorCode(t *testing.T, f wsFrame) string {
	t.Helper()
	var e struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(f.Data, &e))
	return e.Code
}

type partyResponse struct {
	ID         int64   `json:"id"`
	Visibility string  `json:"visibility"`
	ClosedAt   *string `json:"closed_at"`
	Host       struct {
		Username string `json:"username"`
	} `json:"host"`
	Episode struct {
		Number int `json:"number"`
	} `json:"episode"`
}

// TestWatchPartyPresence drives the M4.1 loop over real sockets + real Redis:
// create a party over REST, join from two users (header auth and first-frame
// auth), watch presence converge — state snapshots, member.joined /
// member.left on leave and on disconnect — and the visibility + lifecycle
// gates on join.
func TestWatchPartyPresence(t *testing.T) {
	animeID := seedAnime(t, 900030, "Party Show", "Party Show", 12)

	alice := newClient(t)
	aliceSession := alice.register("party_alice")
	bob := newClient(t)
	bobSession := bob.register("party_bob")

	// Create: alice hosts a public room on episode 1.
	var party partyResponse
	require.Equal(t, http.StatusCreated, alice.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 1, "visibility": "public"}, &party))
	assert.Equal(t, "party_alice", party.Host.Username)
	assert.Equal(t, "public", party.Visibility)
	assert.Equal(t, 1, party.Episode.Number)
	assert.Nil(t, party.ClosedAt)

	// Anyone signed in reads a public party; anonymous does not.
	var got partyResponse
	require.Equal(t, http.StatusOK, bob.do(http.MethodGet, "/api/v1/parties/"+itoa(party.ID), nil, &got))
	assert.Equal(t, party.ID, got.ID)
	anon := newClient(t)
	require.Equal(t, http.StatusUnauthorized, anon.do(http.MethodGet, "/api/v1/parties/"+itoa(party.ID), nil, nil))

	// Alice joins with the bearer header on the upgrade.
	aliceWS := dialParty(t, aliceSession.AccessToken, true)
	defer aliceWS.close()
	var hello struct {
		UserID int64 `json:"user_id"`
	}
	require.NoError(t, json.Unmarshal(aliceWS.waitFor("hello", 3*time.Second).Data, &hello))
	assert.Equal(t, aliceSession.User.ID, hello.UserID)

	aliceWS.send("join", map[string]any{"party": party.ID})
	st := decodeState(t, aliceWS.waitFor("state", 3*time.Second))
	assert.Equal(t, party.ID, st.Party.ID)
	assert.Equal(t, []string{"party_alice"}, usernames(st.Members), "first member sees only herself")

	// Bob joins the browser way: anonymous upgrade, first-frame auth.
	bobWS := dialParty(t, bobSession.AccessToken, false)
	defer bobWS.close()
	bobWS.waitFor("hello", 3*time.Second)
	bobWS.send("join", map[string]any{"party": party.ID})
	st = decodeState(t, bobWS.waitFor("state", 3*time.Second))
	assert.ElementsMatch(t, []string{"party_alice", "party_bob"}, usernames(st.Members),
		"the snapshot is the cross-instance presence set, not this socket's view")

	// Alice learns bob arrived, over pub/sub.
	var joined wsMember
	require.NoError(t, json.Unmarshal(aliceWS.waitFor("member.joined", 3*time.Second).Data, &joined))
	assert.Equal(t, "party_bob", joined.Username)
	assert.Equal(t, bobSession.User.ID, joined.ID)

	// An explicit leave announces the departure; a heartbeat is quiet.
	bobWS.send("leave", map[string]any{})
	var left struct {
		ID int64 `json:"id"`
	}
	require.NoError(t, json.Unmarshal(aliceWS.waitFor("member.left", 3*time.Second).Data, &left))
	assert.Equal(t, bobSession.User.ID, left.ID)
	aliceWS.send("heartbeat", map[string]any{})
	aliceWS.expectNone("error", 300*time.Millisecond)

	// Dropping the socket (no leave frame) still removes the member.
	bobWS.send("join", map[string]any{"party": party.ID})
	bobWS.waitFor("state", 3*time.Second)
	aliceWS.waitFor("member.joined", 3*time.Second)
	bobWS.close()
	require.NoError(t, json.Unmarshal(aliceWS.waitFor("member.left", 3*time.Second).Data, &left))
	assert.Equal(t, bobSession.User.ID, left.ID)

	// Unknown party → not_found on the socket, not a closed connection.
	aliceWS.send("join", map[string]any{"party": 99999999})
	assert.Equal(t, "not_found", errorCode(t, aliceWS.waitFor("error", 3*time.Second)))
	aliceWS.send("nonsense", map[string]any{})
	assert.Equal(t, "bad_request", errorCode(t, aliceWS.waitFor("error", 3*time.Second)))

	// Lifecycle: a host runs one room — a new party closes the previous one,
	// and joining the closed room is refused.
	var second partyResponse
	require.Equal(t, http.StatusCreated, alice.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 2}, &second))
	assert.Equal(t, "followers", second.Visibility, "visibility defaults to followers")
	require.Equal(t, http.StatusOK, alice.do(http.MethodGet, "/api/v1/parties/"+itoa(party.ID), nil, &got))
	assert.NotNil(t, got.ClosedAt, "starting a second party closed the first")

	bob2 := dialParty(t, bobSession.AccessToken, true)
	defer bob2.close()
	bob2.waitFor("hello", 3*time.Second)
	bob2.send("join", map[string]any{"party": party.ID})
	assert.Equal(t, "conflict", errorCode(t, bob2.waitFor("error", 3*time.Second)))

	// Visibility: followers-only refuses a stranger over REST and the socket,
	// then opens once bob follows alice.
	require.Equal(t, http.StatusForbidden, bob.do(http.MethodGet, "/api/v1/parties/"+itoa(second.ID), nil, nil))
	bob2.send("join", map[string]any{"party": second.ID})
	assert.Equal(t, "forbidden", errorCode(t, bob2.waitFor("error", 3*time.Second)))

	require.Equal(t, http.StatusOK, bob.do(http.MethodPut, "/api/v1/users/party_alice/follow", nil, nil))
	require.Equal(t, http.StatusOK, bob.do(http.MethodGet, "/api/v1/parties/"+itoa(second.ID), nil, &got))
	bob2.send("join", map[string]any{"party": second.ID})
	st = decodeState(t, bob2.waitFor("state", 3*time.Second))
	assert.Equal(t, second.ID, st.Party.ID)
	assert.Equal(t, []string{"party_bob"}, usernames(st.Members))

	// Validation on create.
	require.Equal(t, http.StatusUnprocessableEntity, alice.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 1, "visibility": "everyone"}, nil))
	require.Equal(t, http.StatusNotFound, alice.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 999}, nil))
	require.Equal(t, http.StatusUnauthorized, anon.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 1}, nil))
}

// TestWatchPartySocketAuth covers the first-frame gate: a bad token and a
// non-auth first frame are both refused and the socket is closed.
func TestWatchPartySocketAuth(t *testing.T) {
	bad := dialParty(t, "not-a-token", false)
	defer bad.close()
	assert.Equal(t, "unauthorized", errorCode(t, bad.waitFor("error", 3*time.Second)))
	assert.True(t, bad.closed(3*time.Second), "server closes an unauthenticated socket")

	// A join before auth is a policy violation.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	url := "ws" + strings.TrimPrefix(testServer.URL, "http") + "/api/v1/ws"
	c, _, err := websocket.Dial(ctx, url, nil) //nolint:bodyclose // the websocket owns the upgrade response
	require.NoError(t, err)
	defer func() { _ = c.CloseNow() }()
	require.NoError(t, wsjson.Write(ctx, c, map[string]any{"op": "join", "data": map[string]any{"party": 1}}))
	var f wsFrame
	require.NoError(t, wsjson.Read(ctx, c, &f))
	assert.Equal(t, "error", f.Op)
	assert.Equal(t, "unauthorized", errorCode(t, f))
	err = wsjson.Read(ctx, c, &f)
	assert.Equal(t, websocket.StatusPolicyViolation, websocket.CloseStatus(err))
}

// TestWatchPartiesDark builds a router with the flag off against the same
// stores: /features reports it, and every party route is a plain 404 — the
// socket path included.
func TestWatchPartiesDark(t *testing.T) {
	cfg := config.Config{
		Env:             "test",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 720 * time.Hour,
		WebOrigin:       "http://localhost:3000",
		EmailMode:       "log",
		WatchParties:    false,
	}
	handler, err := httpapi.NewRouter(httpapi.Deps{Cfg: cfg, Log: slog.New(slog.DiscardHandler), Pool: testPool, Redis: testRedis})
	require.NoError(t, err)
	dark := httptest.NewServer(handler)
	defer dark.Close()

	get := func(path string) (int, map[string]any) {
		resp, err := http.Get(dark.URL + path)
		require.NoError(t, err)
		defer func() { _ = resp.Body.Close() }()
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return resp.StatusCode, body
	}

	status, body := get("/api/v1/features")
	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, false, body["watch_parties"])

	status, _ = get("/api/v1/parties/1")
	assert.Equal(t, http.StatusNotFound, status)
	status, _ = get("/api/v1/ws")
	assert.Equal(t, http.StatusNotFound, status)

	// And the flagged-on server says so.
	live := newClient(t)
	var features struct {
		WatchParties bool `json:"watch_parties"`
	}
	require.Equal(t, http.StatusOK, live.do(http.MethodGet, "/api/v1/features", nil, &features))
	assert.True(t, features.WatchParties)
}

type wsClock struct {
	Position float64 `json:"position"`
	Playing  bool    `json:"playing"`
	At       string  `json:"at"`
	Duration *int    `json:"duration"`
}

func decodeClock(t *testing.T, f wsFrame) wsClock {
	t.Helper()
	var c wsClock
	require.NoError(t, json.Unmarshal(f.Data, &c))
	return c
}

// TestWatchPartyClock covers M4.2: the join snapshot carries the clock, only
// the host may drive it, play/seek/pause broadcast anchors to everyone, and
// a late joiner lands on the current anchor.
func TestWatchPartyClock(t *testing.T) {
	animeID := seedAnime(t, 900031, "Clock Show", "Clock Show", 12)

	alice := newClient(t)
	aliceSession := alice.register("clock_alice")
	bob := newClient(t)
	bobSession := bob.register("clock_bob")

	var party partyResponse
	require.Equal(t, http.StatusCreated, alice.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 1, "visibility": "public"}, &party))

	host := dialParty(t, aliceSession.AccessToken, true)
	defer host.close()
	host.waitFor("hello", 3*time.Second)
	host.send("join", map[string]any{"party": party.ID})
	var st struct {
		Clock wsClock `json:"clock"`
	}
	require.NoError(t, json.Unmarshal(host.waitFor("state", 3*time.Second).Data, &st))
	assert.Equal(t, 0.0, st.Clock.Position, "a fresh room is paused at 0")
	assert.False(t, st.Clock.Playing)
	assert.NotEmpty(t, st.Clock.At)

	guest := dialParty(t, bobSession.AccessToken, false)
	defer guest.close()
	guest.waitFor("hello", 3*time.Second)
	guest.send("join", map[string]any{"party": party.ID})
	guest.waitFor("state", 3*time.Second)
	host.waitFor("member.joined", 3*time.Second)

	// Only the host drives the clock.
	guest.send("seek", map[string]any{"position": 10})
	assert.Equal(t, "forbidden", errorCode(t, guest.waitFor("error", 3*time.Second)))
	host.expectNone("clock", 300*time.Millisecond)

	// Play broadcasts a running anchor to both sockets.
	host.send("play", map[string]any{})
	c := decodeClock(t, guest.waitFor("clock", 3*time.Second))
	assert.True(t, c.Playing)
	assert.Equal(t, 0.0, c.Position)
	assert.True(t, decodeClock(t, host.waitFor("clock", 3*time.Second)).Playing)

	// Seek keeps playing; pause freezes at (or after) the seek point.
	host.send("seek", map[string]any{"position": 754})
	c = decodeClock(t, guest.waitFor("clock", 3*time.Second))
	assert.True(t, c.Playing)
	assert.Equal(t, 754.0, c.Position)
	host.waitFor("clock", 3*time.Second)

	host.send("pause", map[string]any{})
	c = decodeClock(t, guest.waitFor("clock", 3*time.Second))
	assert.False(t, c.Playing)
	assert.GreaterOrEqual(t, c.Position, 754.0)
	assert.Less(t, c.Position, 760.0)
	host.waitFor("clock", 3*time.Second)

	// A bad seek is rejected without touching the anchor.
	host.send("seek", map[string]any{})
	assert.Equal(t, "bad_request", errorCode(t, host.waitFor("error", 3*time.Second)))

	// A late joiner lands on the persisted anchor.
	carol := newClient(t)
	carolSession := carol.register("clock_carol")
	late := dialParty(t, carolSession.AccessToken, true)
	defer late.close()
	late.waitFor("hello", 3*time.Second)
	late.send("join", map[string]any{"party": party.ID})
	require.NoError(t, json.Unmarshal(late.waitFor("state", 3*time.Second).Data, &st))
	assert.False(t, st.Clock.Playing)
	assert.GreaterOrEqual(t, st.Clock.Position, 754.0)

	// Play with an explicit position restarts from there.
	host.send("play", map[string]any{"position": 100})
	c = decodeClock(t, late.waitFor("clock", 3*time.Second))
	assert.True(t, c.Playing)
	assert.Equal(t, 100.0, c.Position)
}

type wsMessage struct {
	ID        int64    `json:"id"`
	Kind      string   `json:"kind"`
	From      wsMember `json:"from"`
	Body      *string  `json:"body"`
	Emoji     *string  `json:"emoji"`
	Position  *float64 `json:"position"`
	CommentID *int64   `json:"comment_id"`
}

func decodeMessage(t *testing.T, f wsFrame) wsMessage {
	t.Helper()
	var m wsMessage
	require.NoError(t, json.Unmarshal(f.Data, &m))
	return m
}

// TestWatchPartyChat covers M4.3: chat and reactions reach the room, the
// backlog seeds a late joiner, validation and the rate limit answer on the
// socket, and an opted-in message lands in the episode thread as a
// timestamped comment that the thread's REST read returns.
func TestWatchPartyChat(t *testing.T) {
	animeID := seedAnime(t, 900032, "Chat Show", "Chat Show", 12)

	alice := newClient(t)
	aliceSession := alice.register("chat_alice")
	bob := newClient(t)
	bobSession := bob.register("chat_bob")

	var party partyResponse
	require.Equal(t, http.StatusCreated, alice.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 2, "visibility": "public"}, &party))

	host := dialParty(t, aliceSession.AccessToken, true)
	defer host.close()
	host.waitFor("hello", 3*time.Second)
	host.send("join", map[string]any{"party": party.ID})
	host.waitFor("state", 3*time.Second)

	guest := dialParty(t, bobSession.AccessToken, false)
	defer guest.close()
	guest.waitFor("hello", 3*time.Second)
	guest.send("join", map[string]any{"party": party.ID})
	guest.waitFor("state", 3*time.Second)
	host.waitFor("member.joined", 3*time.Second)

	// A chat line reaches both sockets, sender included, with the same id.
	guest.send("chat", map[string]any{"body": "  here we go  "})
	m := decodeMessage(t, host.waitFor("chat", 3*time.Second))
	assert.Equal(t, "chat", m.Kind)
	assert.Equal(t, "chat_bob", m.From.Username)
	assert.Equal(t, "here we go", *m.Body, "trimmed")
	assert.Nil(t, m.CommentID, "not persisted without opt-in")
	own := decodeMessage(t, guest.waitFor("chat", 3*time.Second))
	assert.Equal(t, m.ID, own.ID, "the sender sees its own line with the room's id")

	// Validation answers on the socket.
	guest.send("chat", map[string]any{"body": "   "})
	assert.Equal(t, "validation_failed", errorCode(t, guest.waitFor("error", 3*time.Second)))
	guest.send("react", map[string]any{"emoji": "sparkles"})
	assert.Equal(t, "validation_failed", errorCode(t, guest.waitFor("error", 3*time.Second)))

	// The host starts the clock; a reaction without a position anchors to
	// the clock, one with a position keeps it.
	host.send("seek", map[string]any{"position": 300})
	host.waitFor("clock", 3*time.Second)
	guest.waitFor("clock", 3*time.Second)
	guest.send("react", map[string]any{"emoji": "fire"})
	r := decodeMessage(t, host.waitFor("react", 3*time.Second))
	assert.Equal(t, "react", r.Kind)
	assert.Equal(t, "fire", *r.Emoji)
	require.NotNil(t, r.Position)
	assert.InDelta(t, 300.0, *r.Position, 5)
	guest.waitFor("react", 3*time.Second)

	// Opt-in persistence: the reaction becomes a timestamped comment in the
	// episode thread, and the broadcast carries the comment id.
	guest.send("react", map[string]any{"emoji": "heart", "position": 754, "persist": true})
	r = decodeMessage(t, host.waitFor("react", 3*time.Second))
	require.NotNil(t, r.CommentID)
	assert.Equal(t, 754.0, *r.Position)
	guest.waitFor("react", 3*time.Second)

	guest.send("chat", map[string]any{"body": "that cut!", "persist": true})
	c := decodeMessage(t, host.waitFor("chat", 3*time.Second))
	require.NotNil(t, c.CommentID)
	require.NotNil(t, c.Position, "a chat line persisted after the clock moved is anchored")
	guest.waitFor("chat", 3*time.Second)

	var thread struct {
		Thread struct {
			Id           int64 `json:"id"`
			CommentCount int   `json:"comment_count"`
		} `json:"thread"`
	}
	require.Equal(t, http.StatusOK,
		alice.do(http.MethodGet, "/api/v1/anime/"+itoa(animeID)+"/episodes/2/thread", nil, &thread))
	assert.Equal(t, 2, thread.Thread.CommentCount)
	var comments struct {
		Data []struct {
			Id               int64  `json:"id"`
			Body             string `json:"body"`
			TimestampSeconds *int   `json:"timestamp_seconds"`
			Author           struct {
				Username string `json:"username"`
			} `json:"author"`
		} `json:"data"`
	}
	require.Equal(t, http.StatusOK,
		alice.do(http.MethodGet, "/api/v1/threads/"+itoa(thread.Thread.Id)+"/comments", nil, &comments))
	require.Len(t, comments.Data, 2)
	byID := map[int64]string{}
	for _, cm := range comments.Data {
		byID[cm.Id] = cm.Body
		assert.Equal(t, "chat_bob", cm.Author.Username)
		require.NotNil(t, cm.TimestampSeconds)
	}
	assert.Equal(t, "❤️", byID[*r.CommentID])
	assert.Equal(t, "that cut!", byID[*c.CommentID])

	// A late joiner gets the backlog, oldest first, ids intact.
	carol := newClient(t)
	carolSession := carol.register("chat_carol")
	late := dialParty(t, carolSession.AccessToken, true)
	defer late.close()
	late.waitFor("hello", 3*time.Second)
	late.send("join", map[string]any{"party": party.ID})
	var st struct {
		Chat []wsMessage `json:"chat"`
	}
	require.NoError(t, json.Unmarshal(late.waitFor("state", 3*time.Second).Data, &st))
	require.Len(t, st.Chat, 4)
	assert.Equal(t, m.ID, st.Chat[0].ID)
	assert.Equal(t, "chat", st.Chat[0].Kind)
	assert.Equal(t, c.ID, st.Chat[3].ID)
	assert.True(t, st.Chat[0].ID < st.Chat[1].ID && st.Chat[1].ID < st.Chat[2].ID && st.Chat[2].ID < st.Chat[3].ID, "monotonic ids")

	// The per-user limiter: a burst of ten, then rate_limited.
	for i := 0; i < 12; i++ {
		late.send("chat", map[string]any{"body": "spam"})
	}
	assert.Equal(t, "rate_limited", errorCode(t, late.waitFor("error", 3*time.Second)))

	// Chatting before joining is refused.
	solo := dialParty(t, carolSession.AccessToken, true)
	defer solo.close()
	solo.waitFor("hello", 3*time.Second)
	solo.send("chat", map[string]any{"body": "hello?"})
	assert.Equal(t, "bad_request", errorCode(t, solo.waitFor("error", 3*time.Second)))
}

type partyListResponse struct {
	Data []struct {
		ID       int64 `json:"id"`
		Watching int   `json:"watching"`
		Host     struct {
			Username string `json:"username"`
		} `json:"host"`
	} `json:"data"`
}

func partyIDs(l partyListResponse) []int64 {
	out := make([]int64, 0, len(l.Data))
	for _, p := range l.Data {
		out = append(out, p.ID)
	}
	return out
}

// TestWatchPartyLifecycle covers M4.4: discovery lists open rooms with live
// counts under the visibility rule (anonymous → public only), the host ends
// a room (members get party.closed and are dropped; not the host → 403),
// and the idle sweeper closes rooms nobody has been in.
func TestWatchPartyLifecycle(t *testing.T) {
	animeID := seedAnime(t, 900033, "Lifecycle Show", "Lifecycle Show", 12)

	alice := newClient(t)
	aliceSession := alice.register("life_alice")
	bob := newClient(t)
	bobSession := bob.register("life_bob")
	carol := newClient(t)
	carol.register("life_carol")
	anon := newClient(t)

	// Alice: a public room on ep 3. Carol: a followers-only room on ep 3.
	var pub, priv partyResponse
	require.Equal(t, http.StatusCreated, alice.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 3, "visibility": "public"}, &pub))
	require.Equal(t, http.StatusCreated, carol.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 3}, &priv))

	list := func(c *apiClient, query string) partyListResponse {
		var l partyListResponse
		require.Equal(t, http.StatusOK, c.do(http.MethodGet, "/api/v1/parties"+query, nil, &l))
		return l
	}
	episodeQ := "?anime_id=" + itoa(animeID) + "&episode=3"

	// Anonymous and a stranger see the public room only; carol sees her own.
	assert.Equal(t, []int64{pub.ID}, partyIDs(list(anon, episodeQ)))
	assert.Equal(t, []int64{pub.ID}, partyIDs(list(bob, episodeQ)))
	assert.ElementsMatch(t, []int64{pub.ID, priv.ID}, partyIDs(list(carol, episodeQ)))

	// Bob follows carol → her followers-only room appears for him.
	require.Equal(t, http.StatusOK, bob.do(http.MethodPut, "/api/v1/users/life_carol/follow", nil, nil))
	assert.ElementsMatch(t, []int64{pub.ID, priv.ID}, partyIDs(list(bob, episodeQ)))

	// The episode filter scopes; the unfiltered list carries everything open.
	assert.Empty(t, partyIDs(list(bob, "?anime_id="+itoa(animeID)+"&episode=4")))
	all := partyIDs(list(bob, ""))
	assert.Contains(t, all, pub.ID)
	assert.Contains(t, all, priv.ID)

	// Live counts: two members in alice's room show as watching=2.
	host := dialParty(t, aliceSession.AccessToken, true)
	defer host.close()
	host.waitFor("hello", 3*time.Second)
	host.send("join", map[string]any{"party": pub.ID})
	host.waitFor("state", 3*time.Second)
	guest := dialParty(t, bobSession.AccessToken, true)
	defer guest.close()
	guest.waitFor("hello", 3*time.Second)
	guest.send("join", map[string]any{"party": pub.ID})
	guest.waitFor("state", 3*time.Second)
	host.waitFor("member.joined", 3*time.Second)
	for _, p := range list(anon, episodeQ).Data {
		if p.ID == pub.ID {
			assert.Equal(t, 2, p.Watching)
		}
	}

	// Only the host may end it.
	require.Equal(t, http.StatusForbidden, bob.do(http.MethodPost, "/api/v1/parties/"+itoa(pub.ID)+"/close", nil, nil))
	require.Equal(t, http.StatusNoContent, alice.do(http.MethodPost, "/api/v1/parties/"+itoa(pub.ID)+"/close", nil, nil))
	guest.waitFor("party.closed", 3*time.Second)
	host.waitFor("party.closed", 3*time.Second)
	// Idempotent, and the row + discovery reflect it.
	require.Equal(t, http.StatusNoContent, alice.do(http.MethodPost, "/api/v1/parties/"+itoa(pub.ID)+"/close", nil, nil))
	var got partyResponse
	require.Equal(t, http.StatusOK, bob.do(http.MethodGet, "/api/v1/parties/"+itoa(pub.ID), nil, &got))
	assert.NotNil(t, got.ClosedAt)
	assert.NotContains(t, partyIDs(list(anon, episodeQ)), pub.ID)
	// A member dropped from the closed room can't chat into it.
	guest.send("chat", map[string]any{"body": "still here?"})
	assert.Equal(t, "bad_request", errorCode(t, guest.waitFor("error", 3*time.Second)))
	// Unknown id → 404.
	require.Equal(t, http.StatusNotFound, alice.do(http.MethodPost, "/api/v1/parties/99999999/close", nil, nil))

	// The idle sweeper: carol's room has never had a member. With "now" 20
	// minutes ahead it closes; a room with a fresh heartbeat survives.
	var fresh partyResponse
	require.Equal(t, http.StatusCreated, bob.do(http.MethodPost, "/api/v1/parties",
		map[string]any{"anime_id": animeID, "episode": 5, "visibility": "public"}, &fresh))
	keeper := dialParty(t, bobSession.AccessToken, true)
	defer keeper.close()
	keeper.waitFor("hello", 3*time.Second)
	keeper.send("join", map[string]any{"party": fresh.ID})
	keeper.waitFor("state", 3*time.Second)
	// Ages carol's room past the window in DB time, then sweeps with real now.
	_, err := testPool.Exec(context.Background(),
		"UPDATE watch_parties SET created_at = now() - interval '30 minutes' WHERE id = $1", priv.ID)
	require.NoError(t, err)
	require.NoError(t, jobs.CloseIdleParties(context.Background(), parties.New(testPool, slog.New(slog.DiscardHandler)), testRedis, time.Now(), slog.New(slog.DiscardHandler)))
	require.Equal(t, http.StatusOK, carol.do(http.MethodGet, "/api/v1/parties/"+itoa(priv.ID), nil, &got))
	assert.NotNil(t, got.ClosedAt, "an idle room closes")
	require.Equal(t, http.StatusOK, bob.do(http.MethodGet, "/api/v1/parties/"+itoa(fresh.ID), nil, &got))
	assert.Nil(t, got.ClosedAt, "a room with a live member stays open")
	// A room whose members all left long ago closes too (presence sweeps
	// their heartbeats; the sweeper sees no one and an old creation).
	keeper.send("leave", map[string]any{})
	_, err = testPool.Exec(context.Background(),
		"UPDATE watch_parties SET created_at = now() - interval '30 minutes' WHERE id = $1", fresh.ID)
	require.NoError(t, err)
	require.NoError(t, jobs.CloseIdleParties(context.Background(), parties.New(testPool, slog.New(slog.DiscardHandler)), testRedis, time.Now(), slog.New(slog.DiscardHandler)))
	require.Equal(t, http.StatusOK, bob.do(http.MethodGet, "/api/v1/parties/"+itoa(fresh.ID), nil, &got))
	assert.NotNil(t, got.ClosedAt)
}
