package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"
)

// Live chat + timestamped reactions (docs/WATCH_PARTIES.md, M4.3). Both are
// room events on the party bus; a capped backlog in Redis lets a late joiner
// see the last few minutes. With the author's opt-in a message also lands in
// the episode thread as a timestamped comment — that is how a party enriches
// the async thread instead of competing with it. Cour's language policy and a
// per-user rate limit apply to the live stream too.

const (
	OpChat  = "chat"
	OpReact = "react"

	KindChat  = "chat"
	KindReact = "react"
)

const (
	maxChatBody = 500
	// The backlog a late joiner receives in `state.chat`.
	chatBacklog = 50
	chatKeyTTL  = 24 * time.Hour
)

// chatLimit is per user across all rooms: a burst of ten, then one a second.
var chatLimit = redis_rate.Limit{Rate: 10, Burst: 10, Period: 10 * time.Second}

// validEmojis mirrors the comment-reaction vocabulary (spec: Emoji).
var validEmojis = map[string]string{
	"+1": "👍", "heart": "❤️", "laugh": "😂", "surprise": "😮", "cry": "😢", "fire": "🔥",
}

// Message is one chat line or reaction as broadcast and backlogged.
type Message struct {
	ID        int64       `json:"id"`
	Kind      string      `json:"kind"`
	From      partyMember `json:"from"`
	Body      *string     `json:"body"`
	Emoji     *string     `json:"emoji"`
	Position  *float64    `json:"position"`
	At        time.Time   `json:"at"`
	CommentID *int64      `json:"comment_id"`
}

type chatRequest struct {
	Body    string `json:"body"`
	Persist bool   `json:"persist"`
}

type reactRequest struct {
	Emoji    string   `json:"emoji"`
	Position *float64 `json:"position"`
	Persist  bool     `json:"persist"`
}

// TextFilter is the language policy (moderation's filter satisfies it; the
// same instance discussions uses).
type TextFilter interface {
	Flagged(text string) bool
}

// Persister writes an opted-in message into the episode thread as a
// timestamped comment and returns the comment id. httpapi provides it over
// the discussions service so the thread's SSE and notifications fire exactly
// as for a REST post.
type Persister interface {
	PersistComment(ctx context.Context, userID, animeID int64, episode int32, body string, position *float64) (int64, error)
}

// ErrFlagged is returned by Persister/filters when the language policy trips.
var ErrFlagged = errors.New("realtime: flagged by the language policy")

// SetPersister wires opt-in persistence; without it `persist` is ignored.
func (g *PartyGateway) SetPersister(p Persister) { g.persister = p }

// SetTextFilter applies the language policy to live chat.
func (g *PartyGateway) SetTextFilter(f TextFilter) { g.filter = f }

func chatKey(partyID int64) string { return "party:" + strconv.FormatInt(partyID, 10) + ":chat" }
func seqKey(partyID int64) string  { return "party:" + strconv.FormatInt(partyID, 10) + ":seq" }

// nextID hands out monotonic per-room message ids (the client's dedupe key).
func (g *PartyGateway) nextID(ctx context.Context, partyID int64) (int64, error) {
	pipe := g.rdb.TxPipeline()
	incr := pipe.Incr(ctx, seqKey(partyID))
	pipe.Expire(ctx, seqKey(partyID), chatKeyTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return incr.Val(), nil
}

// appendBacklog pushes a message onto the room's capped list.
func (g *PartyGateway) appendBacklog(ctx context.Context, partyID int64, m Message) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	key := chatKey(partyID)
	pipe := g.rdb.TxPipeline()
	pipe.RPush(ctx, key, raw)
	pipe.LTrim(ctx, key, -chatBacklog, -1)
	pipe.Expire(ctx, key, chatKeyTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// backlog reads the last messages, oldest first. Undecodable entries (a
// future shape change) are skipped, never fatal.
func (g *PartyGateway) backlog(ctx context.Context, partyID int64) ([]Message, error) {
	raws, err := g.rdb.LRange(ctx, chatKey(partyID), 0, -1).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	out := make([]Message, 0, len(raws))
	for _, r := range raws {
		var m Message
		if json.Unmarshal([]byte(r), &m) == nil {
			out = append(out, m)
		}
	}
	return out, nil
}

// allowChat is the per-user limiter for chat + reactions.
func (g *PartyGateway) allowChat(ctx context.Context, userID int64) (bool, error) {
	res, err := g.limiter.Allow(ctx, "rl:party:chat:"+strconv.FormatInt(userID, 10), chatLimit)
	if err != nil {
		return false, err
	}
	return res.Allowed > 0, nil
}

// validateChat trims and bounds a chat body.
func validateChat(body string) (string, bool) {
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > maxChatBody {
		return "", false
	}
	return body, true
}
