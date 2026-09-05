package realtime

import (
	"context"
	"math"
	"strconv"
	"time"
)

// The shared clock (docs/WATCH_PARTIES.md, M4.2) is an anchor, not a stream:
// {position, playing, at}. While playing, everyone renders
// position + (now − at); only state changes (host play/pause/seek) cross the
// wire, plus a periodic sync so client interpolation can't drift. Cour never
// drives a player — the clock is a stopwatch people line their own legal
// stream up with.

// Clock is the anchor as stored and sent.
type Clock struct {
	// Position in seconds that was true at At.
	Position float64 `json:"position"`
	Playing  bool    `json:"playing"`
	// At is server time; the anchor's reference point.
	At time.Time `json:"at"`
	// Duration in seconds when the catalog knows the episode length, else nil.
	Duration *int `json:"duration"`
}

// Clock ops, client → server (host only) and server → client.
const (
	OpPlay  = "play"
	OpPause = "pause"
	OpSeek  = "seek"
	OpClock = "clock"
	OpSync  = "sync"
)

const (
	syncEvery   = 30 * time.Second
	clockKeyTTL = 24 * time.Hour
)

// positionAt interpolates the anchor to now. Paused clocks don't move; a
// clock can't run backwards past 0 or (when known) past the duration.
func (c Clock) positionAt(now time.Time) float64 {
	p := c.Position
	if c.Playing {
		p += now.Sub(c.At).Seconds()
	}
	return c.clamp(p)
}

func (c Clock) clamp(p float64) float64 {
	if p < 0 || math.IsNaN(p) {
		return 0
	}
	if c.Duration != nil && p > float64(*c.Duration) {
		return float64(*c.Duration)
	}
	return p
}

// synced re-anchors the clock at now without changing what it shows — the
// shape every periodic sync and every join snapshot sends.
func (c Clock) synced(now time.Time) Clock {
	return Clock{Position: c.positionAt(now), Playing: c.Playing, At: now, Duration: c.Duration}
}

// play starts the clock from position when given, else from wherever it is
// (resume). Playing past the end is a no-op pause at the end.
func (c Clock) play(now time.Time, position *float64) Clock {
	p := c.positionAt(now)
	if position != nil {
		p = c.clamp(*position)
	}
	next := Clock{Position: p, Playing: true, At: now, Duration: c.Duration}
	if c.Duration != nil && p >= float64(*c.Duration) {
		next.Playing = false
	}
	return next
}

// pause freezes at position when given, else at the current interpolated
// position.
func (c Clock) pause(now time.Time, position *float64) Clock {
	p := c.positionAt(now)
	if position != nil {
		p = c.clamp(*position)
	}
	return Clock{Position: p, Playing: false, At: now, Duration: c.Duration}
}

// seek jumps to position, keeping the play/pause state.
func (c Clock) seek(now time.Time, position float64) Clock {
	next := Clock{Position: c.clamp(position), Playing: c.Playing, At: now, Duration: c.Duration}
	if c.Duration != nil && next.Position >= float64(*c.Duration) {
		next.Playing = false
	}
	return next
}

// ── Persistence (Redis hash: party:{id}:clock) ────────────────────────────

func clockKey(partyID int64) string {
	return "party:" + strconv.FormatInt(partyID, 10) + ":clock"
}

// loadClock reads the room's anchor; a room with no clock yet is paused at
// 0. duration is applied from the catalog on every read so a synced anime
// row reaches running rooms.
func (g *PartyGateway) loadClock(ctx context.Context, partyID int64, duration *int) (Clock, error) {
	fields, err := g.rdb.HGetAll(ctx, clockKey(partyID)).Result()
	if err != nil {
		return Clock{}, err
	}
	c := Clock{At: g.now(), Duration: duration}
	if len(fields) == 0 {
		return c, nil
	}
	if v, err := strconv.ParseFloat(fields["position"], 64); err == nil {
		c.Position = v
	}
	c.Playing = fields["playing"] == "1"
	if v, err := strconv.ParseInt(fields["at"], 10, 64); err == nil {
		c.At = time.UnixMilli(v)
	}
	return c, nil
}

func (g *PartyGateway) saveClock(ctx context.Context, partyID int64, c Clock) error {
	key := clockKey(partyID)
	playing := "0"
	if c.Playing {
		playing = "1"
	}
	pipe := g.rdb.TxPipeline()
	pipe.HSet(ctx, key, map[string]any{
		"position": strconv.FormatFloat(c.Position, 'f', 3, 64),
		"playing":  playing,
		"at":       strconv.FormatInt(c.At.UnixMilli(), 10),
	})
	pipe.Expire(ctx, key, clockKeyTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// durationSeconds converts the catalog's per-episode minutes.
func durationSeconds(minutes *int32) *int {
	if minutes == nil || *minutes <= 0 {
		return nil
	}
	s := int(*minutes) * 60
	return &s
}

// clockRequest is the play/pause/seek payload.
type clockRequest struct {
	Position *float64 `json:"position"`
}
