package discussions

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/store/sqlcgen"
)

func TestScoreThreadsDecayAndPresence(t *testing.T) {
	now := time.Date(2026, 7, 7, 22, 0, 0, 0, time.UTC)
	halfLife := 6 * time.Hour
	comment := func(thread int64, age time.Duration) sqlcgen.RecentCommentsRow {
		return sqlcgen.RecentCommentsRow{ThreadID: thread, CreatedAt: now.Add(-age)}
	}

	t.Run("fresh comments outrank more but older ones", func(t *testing.T) {
		// Thread 1: 3 fresh comments. Thread 2: 5 day-old ones (decayed to
		// 5·2^-4 = 0.3125 < 3).
		ranked := scoreThreads([]sqlcgen.RecentCommentsRow{
			comment(1, 0), comment(1, 0), comment(1, 0),
			comment(2, 24*time.Hour), comment(2, 24*time.Hour), comment(2, 24*time.Hour),
			comment(2, 24*time.Hour), comment(2, 24*time.Hour),
		}, nil, halfLife, now)

		require.Len(t, ranked, 2)
		assert.Equal(t, int64(1), ranked[0].ThreadID)
		assert.Equal(t, 3, ranked[0].RecentComments)
		assert.Equal(t, 5, ranked[1].RecentComments, "count is raw, only score decays")
	})

	t.Run("half-life is exact", func(t *testing.T) {
		ranked := scoreThreads([]sqlcgen.RecentCommentsRow{comment(1, 6*time.Hour)}, nil, halfLife, now)
		require.Len(t, ranked, 1)
		assert.InDelta(t, 0.5, ranked[0].Score, 1e-9)
	})

	t.Run("future timestamps clamp to zero age", func(t *testing.T) {
		ranked := scoreThreads([]sqlcgen.RecentCommentsRow{comment(1, -time.Hour)}, nil, halfLife, now)
		require.Len(t, ranked, 1)
		assert.InDelta(t, 1.0, ranked[0].Score, 1e-9)
	})

	t.Run("lurker-only thread ranks on presence alone", func(t *testing.T) {
		// Thread 9 has no comments but 4 live readers (score 8); thread 1 has
		// one fresh comment (score 1).
		ranked := scoreThreads([]sqlcgen.RecentCommentsRow{comment(1, 0)},
			map[int64]int{9: 4}, halfLife, now)

		require.Len(t, ranked, 2)
		assert.Equal(t, int64(9), ranked[0].ThreadID)
		assert.Equal(t, 4, ranked[0].Presence)
		assert.Equal(t, 0, ranked[0].RecentComments)
	})

	t.Run("presence adds to comment heat", func(t *testing.T) {
		ranked := scoreThreads([]sqlcgen.RecentCommentsRow{comment(1, 0)},
			map[int64]int{1: 1}, halfLife, now)

		require.Len(t, ranked, 1)
		assert.InDelta(t, 1.0+presenceWeight, ranked[0].Score, 1e-9)
		assert.Equal(t, 1, ranked[0].Presence)
		assert.Equal(t, 1, ranked[0].RecentComments)
	})

	t.Run("zero-presence rooms are ignored", func(t *testing.T) {
		ranked := scoreThreads(nil, map[int64]int{7: 0}, halfLife, now)
		assert.Empty(t, ranked)
	})

	t.Run("ties break to the lower thread id", func(t *testing.T) {
		ranked := scoreThreads([]sqlcgen.RecentCommentsRow{comment(5, 0), comment(3, 0)}, nil, halfLife, now)
		require.Len(t, ranked, 2)
		assert.Equal(t, int64(3), ranked[0].ThreadID)
		assert.Equal(t, int64(5), ranked[1].ThreadID)
	})
}
