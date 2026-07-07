package realtime

import (
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestHub builds a Hub without a Redis connection. Everything except the
// pub/sub bridge (Publish/receive/Close) is exercisable this way; the Redis
// round-trip is covered by the integration suite.
func newTestHub() *Hub {
	return &Hub{log: slog.New(slog.DiscardHandler), rooms: make(map[int64]*room)}
}

func presenceCount(t *testing.T, ev Event) int {
	t.Helper()
	require.Equal(t, EventPresence, ev.Name)
	var p presencePayload
	require.NoError(t, json.Unmarshal(ev.Data, &p))
	return p.Count
}

// recv reads the next event without blocking the test forever.
func recv(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case ev := <-ch:
		return ev
	default:
		t.Fatal("expected an event, channel was empty")
		return Event{}
	}
}

func TestSubscribeEmitsPresence(t *testing.T) {
	h := newTestHub()

	ch1, cleanup1 := h.Subscribe(7)
	assert.Equal(t, 1, presenceCount(t, recv(t, ch1)), "first subscriber sees itself")
	assert.Equal(t, 1, h.Presence(7))

	ch2, cleanup2 := h.Subscribe(7)
	// Both readers learn the count rose to 2.
	assert.Equal(t, 2, presenceCount(t, recv(t, ch1)))
	assert.Equal(t, 2, presenceCount(t, recv(t, ch2)))
	assert.Equal(t, 2, h.Presence(7))

	// A different thread is isolated.
	assert.Equal(t, 0, h.Presence(99))

	cleanup1()
	assert.Equal(t, 1, h.Presence(7))
	assert.Equal(t, 1, presenceCount(t, recv(t, ch2)), "remaining reader sees the count fall")

	cleanup2()
	assert.Equal(t, 0, h.Presence(7))
	// The room is gone once empty.
	h.mu.Lock()
	_, exists := h.rooms[7]
	h.mu.Unlock()
	assert.False(t, exists)
}

func TestDispatchFansOutToAll(t *testing.T) {
	h := newTestHub()
	ch1, _ := h.Subscribe(1)
	ch2, _ := h.Subscribe(1)
	// Drain the presence events (1 for ch1, then 2 for both).
	recv(t, ch1)
	recv(t, ch1)
	recv(t, ch2)

	want := Encode(EventCommentCreated, map[string]any{"id": 42})
	h.dispatch(1, want)

	got1, got2 := recv(t, ch1), recv(t, ch2)
	assert.Equal(t, EventCommentCreated, got1.Name)
	assert.Equal(t, EventCommentCreated, got2.Name)
	assert.JSONEq(t, string(want.Data), string(got1.Data))
	assert.JSONEq(t, string(want.Data), string(got2.Data))
}

func TestDispatchToUnknownThreadIsNoop(t *testing.T) {
	h := newTestHub()
	// No panic, nothing to deliver.
	h.dispatch(123, Encode(EventCommentCreated, map[string]any{}))
}

func TestSlowSubscriberDropsRatherThanBlocks(t *testing.T) {
	h := newTestHub()
	ch, _ := h.Subscribe(1)
	// One presence event is already buffered; flood well past the buffer.
	for i := 0; i < subscriberBuffer+100; i++ {
		h.dispatch(1, Encode(EventCommentCreated, map[string]any{"i": i}))
	}
	// The buffer caps out; excess is dropped, and dispatch never blocked.
	assert.Equal(t, subscriberBuffer, len(ch))
}

func TestCleanupIsIdempotent(t *testing.T) {
	h := newTestHub()
	_, cleanup := h.Subscribe(5)
	cleanup()
	assert.NotPanics(t, cleanup, "double cleanup must be safe")
	assert.Equal(t, 0, h.Presence(5))
}

func TestChannelRoundTrip(t *testing.T) {
	id, err := threadIDFromChannel(channel(4242))
	require.NoError(t, err)
	assert.Equal(t, int64(4242), id)

	_, err = threadIDFromChannel("notathread:1")
	assert.Error(t, err)
	_, err = threadIDFromChannel("thread:abc")
	assert.Error(t, err)
}
