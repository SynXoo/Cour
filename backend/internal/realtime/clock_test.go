package realtime

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func ptr[T any](v T) *T { return &v }

func TestClockInterpolates(t *testing.T) {
	t0 := time.Date(2026, 9, 5, 20, 0, 0, 0, time.UTC)
	paused := Clock{Position: 100, Playing: false, At: t0}
	assert.Equal(t, 100.0, paused.positionAt(t0.Add(time.Minute)), "paused clocks don't move")

	playing := Clock{Position: 100, Playing: true, At: t0}
	assert.InDelta(t, 130.0, playing.positionAt(t0.Add(30*time.Second)), 1e-9)

	// Re-anchoring keeps what the clock shows and moves the reference point.
	s := playing.synced(t0.Add(30 * time.Second))
	assert.InDelta(t, 130.0, s.Position, 1e-9)
	assert.True(t, s.Playing)
	assert.Equal(t, t0.Add(30*time.Second), s.At)
	assert.InDelta(t, 140.0, s.positionAt(t0.Add(40*time.Second)), 1e-9)
}

func TestClockHostOps(t *testing.T) {
	t0 := time.Date(2026, 9, 5, 20, 0, 0, 0, time.UTC)
	c := Clock{Duration: ptr(1440)} // 24 min episode, paused at 0

	// Play from the start.
	c = c.play(t0, nil)
	assert.True(t, c.Playing)
	assert.Equal(t, 0.0, c.Position)

	// Pause 90 s later freezes at the interpolated position.
	c = c.pause(t0.Add(90*time.Second), nil)
	assert.False(t, c.Playing)
	assert.InDelta(t, 90.0, c.Position, 1e-9)

	// Resume keeps that anchor; an explicit position wins over it.
	c = c.play(t0.Add(2*time.Minute), nil)
	assert.InDelta(t, 90.0, c.Position, 1e-9)
	c = c.play(t0.Add(2*time.Minute), ptr(600.0))
	assert.Equal(t, 600.0, c.Position)

	// Seek keeps the play state; a pause with a position lands exactly there.
	c = c.seek(t0.Add(3*time.Minute), 754)
	assert.True(t, c.Playing)
	assert.Equal(t, 754.0, c.Position)
	c = c.pause(t0.Add(3*time.Minute), ptr(700.0))
	assert.Equal(t, 700.0, c.Position)
	assert.False(t, c.Playing)
}

func TestClockClamps(t *testing.T) {
	t0 := time.Now()
	c := Clock{Duration: ptr(100)}
	assert.Equal(t, 0.0, c.seek(t0, -5).Position, "never before the start")
	end := c.seek(t0, 500)
	assert.Equal(t, 100.0, end.Position, "never past a known end")
	assert.False(t, end.Playing, "seeking to the end pauses")

	running := Clock{Position: 95, Playing: true, At: t0, Duration: ptr(100)}
	assert.Equal(t, 100.0, running.positionAt(t0.Add(time.Hour)), "interpolation stops at the end")
	assert.False(t, running.play(t0.Add(time.Hour), nil).Playing, "play at the end stays paused")

	open := Clock{Position: 95, Playing: true, At: t0}
	assert.InDelta(t, 3695.0, open.positionAt(t0.Add(time.Hour)), 1e-6, "no duration, no ceiling")
}

func TestDurationSeconds(t *testing.T) {
	assert.Nil(t, durationSeconds(nil))
	assert.Nil(t, durationSeconds(ptr(int32(0))))
	assert.Equal(t, 1440, *durationSeconds(ptr(int32(24))))
}
