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
