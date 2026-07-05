package discovery

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/store/sqlcgen"
)

var testWeights = map[sqlcgen.ActivityType]float64{
	sqlcgen.ActivityTypeListAdd:  1.0,
	sqlcgen.ActivityTypeReview:   3.0,
	sqlcgen.ActivityTypeFavorite: 2.5,
}

func TestScoreEventsDecay(t *testing.T) {
	now := time.Now()
	halfLife := 96 * time.Hour

	fresh := scoreEvents([]event{
		{AnimeID: 1, Type: sqlcgen.ActivityTypeListAdd, CreatedAt: now},
	}, testWeights, halfLife, now)
	assert.InDelta(t, 1.0, fresh[1], 1e-9, "zero-age event scores its full weight")

	aged := scoreEvents([]event{
		{AnimeID: 1, Type: sqlcgen.ActivityTypeListAdd, CreatedAt: now.Add(-halfLife)},
	}, testWeights, halfLife, now)
	assert.InDelta(t, 0.5, aged[1], 1e-9, "one half-life halves the contribution")

	twoLives := scoreEvents([]event{
		{AnimeID: 1, Type: sqlcgen.ActivityTypeListAdd, CreatedAt: now.Add(-2 * halfLife)},
	}, testWeights, halfLife, now)
	assert.InDelta(t, 0.25, twoLives[1], 1e-9)
}

func TestScoreEventsWeighting(t *testing.T) {
	now := time.Now()
	scores := scoreEvents([]event{
		{AnimeID: 1, Type: sqlcgen.ActivityTypeReview, CreatedAt: now},
		{AnimeID: 2, Type: sqlcgen.ActivityTypeListAdd, CreatedAt: now},
		{AnimeID: 2, Type: sqlcgen.ActivityTypeListAdd, CreatedAt: now},
	}, testWeights, 96*time.Hour, now)

	assert.InDelta(t, 3.0, scores[1], 1e-9, "one review outweighs two list adds")
	assert.InDelta(t, 2.0, scores[2], 1e-9)
}

func TestRecencyBeatsVolume(t *testing.T) {
	// The thesis in miniature: a burst of activity NOW must outrank a bigger
	// pile of activity from ten days ago.
	now := time.Now()
	old := now.Add(-10 * 24 * time.Hour)

	events := []event{
		// Anime 1: 3 favorites today.
		{AnimeID: 1, Type: sqlcgen.ActivityTypeFavorite, CreatedAt: now},
		{AnimeID: 1, Type: sqlcgen.ActivityTypeFavorite, CreatedAt: now},
		{AnimeID: 1, Type: sqlcgen.ActivityTypeFavorite, CreatedAt: now},
		// Anime 2: 10 favorites ten days ago.
	}
	for i := 0; i < 10; i++ {
		events = append(events, event{AnimeID: 2, Type: sqlcgen.ActivityTypeFavorite, CreatedAt: old})
	}

	scores := scoreEvents(events, testWeights, 96*time.Hour, now)
	assert.Greater(t, scores[1], scores[2], "recent buzz must beat stale volume")
}

func TestBlendUpstreamNormalizes(t *testing.T) {
	scores := map[int64]float64{1: 5.0}
	blendUpstream(scores, map[int64]int32{1: 50, 2: 100}, 0.15)

	assert.InDelta(t, 5.0+0.15*0.5*upstreamScale, scores[1], 1e-9)
	assert.InDelta(t, 0.15*1.0*upstreamScale, scores[2], 1e-9, "upstream-only titles enter the ranking")

	untouched := map[int64]float64{1: 5.0}
	blendUpstream(untouched, map[int64]int32{1: 100}, 0)
	assert.InDelta(t, 5.0, untouched[1], 1e-9, "beta=0 disables the blend")
}

func TestRankScoresDeterministic(t *testing.T) {
	ranked := rankScores(map[int64]float64{3: 1.0, 1: 1.0, 2: 2.0}, 10)
	require.Len(t, ranked, 3)
	assert.EqualValues(t, 2, ranked[0].AnimeID)
	assert.EqualValues(t, 1, ranked[1].AnimeID, "ties break on id")
	assert.EqualValues(t, 3, ranked[2].AnimeID)

	capped := rankScores(map[int64]float64{1: 1, 2: 2, 3: 3}, 2)
	assert.Len(t, capped, 2)
}
