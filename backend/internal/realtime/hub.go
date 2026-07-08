// Package realtime is the live thread layer. A per-instance Hub fans thread
// events out to connected Server-Sent-Events subscribers; Redis pub/sub
// bridges instances so any instance serves any thread. Presence is simply the
// count of live connections.
//
// One pattern subscription (thread:*) means this instance receives every
// thread's events — at Cour's scale that is cheaper than churning a per-thread
// subscription as readers come and go. The Publish/channel contract does not
// change if a future multi-instance build swaps to dynamic per-thread
// SUBSCRIBE, so callers never see it. Presence is per-instance and in-memory;
// summing it across instances (publishing per-instance tallies over Redis) is
// the documented swap-in for when more than one instance runs.
//
// M4's watch-party rooms reuse this same registry + pub/sub plumbing.
package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Event is one SSE message: a named event carrying a JSON data payload. The
// name becomes the SSE `event:` line, Data the `data:` line.
type Event struct {
	Name string          `json:"name"`
	Data json.RawMessage `json:"data"`
}

// Event names. The comment.*/reaction.* payloads mirror the REST DTOs so the
// client merges them straight into its query cache; presence is Hub-generated.
const (
	EventCommentCreated  = "comment.created"
	EventCommentDeleted  = "comment.deleted"
	EventReactionUpdated = "reaction.updated"
	EventPresence        = "presence"
)

const (
	channelPrefix = "thread:"
	// Per-subscriber buffer. A reader that falls this far behind is dropped
	// event-by-event (the client's refetch degrade path reconciles), so one
	// slow SSE consumer can't stall fan-out to everyone else.
	subscriberBuffer = 32
)

// Encode builds an Event, marshaling payload into the data line.
func Encode(name string, payload any) Event {
	raw, err := json.Marshal(payload)
	if err != nil {
		// Payloads are plain structs; a marshal failure is a programming bug,
		// not a runtime condition — emit a well-formed null rather than panic
		// on a live connection.
		raw = json.RawMessage("null")
	}
	return Event{Name: name, Data: raw}
}

type subscriber struct {
	ch chan Event
}

type room struct {
	subs map[*subscriber]struct{}
}

// Hub is the per-instance fan-out registry.
type Hub struct {
	log    *slog.Logger
	rdb    *redis.Client
	pubsub *redis.PubSub

	mu    sync.Mutex
	rooms map[int64]*room
}

// NewHub subscribes to the thread:* pattern and starts routing events to local
// subscribers. Call Close to release the subscription.
func NewHub(rdb *redis.Client, log *slog.Logger) *Hub {
	h := &Hub{
		log:    log,
		rdb:    rdb,
		pubsub: rdb.PSubscribe(context.Background(), channelPrefix+"*"),
		rooms:  make(map[int64]*room),
	}
	go h.receive()
	return h
}

// receive routes every published thread event to this instance's local
// subscribers. It runs until Close closes the pub/sub channel.
func (h *Hub) receive() {
	for msg := range h.pubsub.Channel() {
		threadID, err := threadIDFromChannel(msg.Channel)
		if err != nil {
			h.log.Warn("realtime: undecodable channel", "channel", msg.Channel, "err", err)
			continue
		}
		var ev Event
		if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
			h.log.Warn("realtime: undecodable payload", "channel", msg.Channel, "err", err)
			continue
		}
		h.dispatch(threadID, ev)
	}
}

// Close stops the pub/sub receive loop.
func (h *Hub) Close() error { return h.pubsub.Close() }

// Publish fans an event out to every instance serving the thread (including
// this one, via the pattern subscription). Best-effort: a Redis error is
// logged, never returned to the user action that triggered it.
func (h *Hub) Publish(ctx context.Context, threadID int64, ev Event) {
	raw, err := json.Marshal(ev)
	if err != nil {
		h.log.Error("realtime: marshal event", "err", err)
		return
	}
	if err := h.rdb.Publish(ctx, channel(threadID), raw).Err(); err != nil {
		h.log.Warn("realtime: publish", "thread_id", threadID, "err", err)
	}
}

// Subscribe registers a live reader on a thread. It returns the reader's event
// channel and a cleanup func that MUST be called when the reader disconnects.
// The new subscriber and everyone already on the thread immediately receive a
// presence event carrying the updated count.
func (h *Hub) Subscribe(threadID int64) (<-chan Event, func()) {
	s := &subscriber{ch: make(chan Event, subscriberBuffer)}

	h.mu.Lock()
	rm := h.rooms[threadID]
	if rm == nil {
		rm = &room{subs: make(map[*subscriber]struct{})}
		h.rooms[threadID] = rm
	}
	rm.subs[s] = struct{}{}
	h.dispatchLocked(rm, presenceEvent(len(rm.subs)))
	h.mu.Unlock()

	var once sync.Once
	cleanup := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if rm := h.rooms[threadID]; rm != nil {
				delete(rm.subs, s)
				if len(rm.subs) == 0 {
					delete(h.rooms, threadID)
				} else {
					h.dispatchLocked(rm, presenceEvent(len(rm.subs)))
				}
			}
			close(s.ch)
		})
	}
	return s.ch, cleanup
}

// Presence reports the number of live readers on a thread (this instance).
func (h *Hub) Presence(threadID int64) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	if rm := h.rooms[threadID]; rm != nil {
		return len(rm.subs)
	}
	return 0
}

// Presences snapshots every thread with at least one live reader (this
// instance). Thread trending unions this with recent-comment candidates so a
// room full of lurkers waiting for an episode can rank before anyone posts.
func (h *Hub) Presences() map[int64]int {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make(map[int64]int, len(h.rooms))
	for id, rm := range h.rooms {
		out[id] = len(rm.subs)
	}
	return out
}

func (h *Hub) dispatch(threadID int64, ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if rm := h.rooms[threadID]; rm != nil {
		h.dispatchLocked(rm, ev)
	}
}

// dispatchLocked sends to every subscriber without blocking; a full buffer
// (slow reader) drops the event. The caller holds h.mu, so no send can race a
// subscriber's removal-and-close in cleanup.
func (h *Hub) dispatchLocked(rm *room, ev Event) {
	for s := range rm.subs {
		select {
		case s.ch <- ev:
		default:
		}
	}
}

type presencePayload struct {
	Count int `json:"count"`
}

func presenceEvent(count int) Event {
	return Encode(EventPresence, presencePayload{Count: count})
}

func channel(threadID int64) string {
	return channelPrefix + strconv.FormatInt(threadID, 10)
}

func threadIDFromChannel(name string) (int64, error) {
	rest, ok := strings.CutPrefix(name, channelPrefix)
	if !ok {
		return 0, fmt.Errorf("missing %q prefix", channelPrefix)
	}
	return strconv.ParseInt(rest, 10, 64)
}
