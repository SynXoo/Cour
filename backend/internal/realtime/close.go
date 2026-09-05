package realtime

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Room lifecycle (docs/WATCH_PARTIES.md, M4.4). Closing a party is a
// Postgres fact (closed_at, owned by internal/parties); this file is the
// live side of it: drop the room's Redis state and tell every member. It is
// a plain function over a Redis client so the worker's idle sweeper can call
// it without a gateway.

// OpPartyClosed tells members the room ended; the server drops them from
// the room right after.
const OpPartyClosed = "party.closed"

// CloseParty deletes the room's live state and broadcasts party.closed on
// the party bus channel. Idempotent; safe on a room that never had state.
func CloseParty(ctx context.Context, rdb *redis.Client, partyID int64) error {
	ev := Encode(OpPartyClosed, struct{}{})
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	pipe := rdb.TxPipeline()
	pipe.Publish(ctx, partyBusPrefix+strconv.FormatInt(partyID, 10), raw)
	pipe.Del(ctx, presenceKey(partyID), clockKey(partyID), chatKey(partyID), seqKey(partyID))
	_, err = pipe.Exec(ctx)
	return err
}

// CloseRoom is CloseParty through the gateway (the API's close endpoint).
func (g *PartyGateway) CloseRoom(ctx context.Context, partyID int64) error {
	return CloseParty(ctx, g.rdb, partyID)
}

// LastSeen is the newest heartbeat in a room's presence set, or the zero
// time when nobody is (or ever was) recorded. The idle sweeper reads it.
func LastSeen(ctx context.Context, rdb *redis.Client, partyID int64) (time.Time, error) {
	zs, err := rdb.ZRevRangeWithScores(ctx, presenceKey(partyID), 0, 0).Result()
	if err != nil {
		return time.Time{}, err
	}
	if len(zs) == 0 {
		return time.Time{}, nil
	}
	return time.Unix(int64(zs[0].Score), 0), nil
}
