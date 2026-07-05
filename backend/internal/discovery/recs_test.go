package discovery

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func set(ids ...int64) map[int64]bool {
	m := make(map[int64]bool, len(ids))
	for _, id := range ids {
		m[id] = true
	}
	return m
}

func TestJaccard(t *testing.T) {
	assert.InDelta(t, 1.0, jaccard(set(1, 2), set(1, 2)), 1e-9)
	assert.InDelta(t, 1.0/3.0, jaccard(set(1, 2), set(2, 3)), 1e-9)
	assert.InDelta(t, 0.0, jaccard(set(1), set(2)), 1e-9)
	assert.InDelta(t, 0.0, jaccard(set(), set(1)), 1e-9)
}

func TestRankNeighborsOrdersBySimilarity(t *testing.T) {
	mine := set(1, 2, 3, 4)
	neighbors := rankNeighbors(mine, map[int64]map[int64]bool{
		10: set(1, 2, 3, 4), // identical -> sim 1.0
		11: set(1, 9),       // sim 1/5
		12: set(7, 8),       // sim 0 -> dropped
	}, 10)

	require.Len(t, neighbors, 2)
	assert.EqualValues(t, 10, neighbors[0].UserID)
	assert.EqualValues(t, 11, neighbors[1].UserID)
}

func i16p(v int16) *int16 { return &v }

func TestScoreCandidates(t *testing.T) {
	mine := set(1, 2)
	neighbors := []neighbor{
		{UserID: 10, Sim: 1.0, Taste: set(1, 2)},
		{UserID: 11, Sim: 0.2, Taste: set(1, 9)},
	}
	signals := []signal{
		{UserID: 10, AnimeID: 100, Watching: true},  // 1.0 * 1.0
		{UserID: 11, AnimeID: 100, Watching: true},  // 0.2 * 1.0
		{UserID: 11, AnimeID: 200, Score: i16p(10)}, // 0.2 * 2.4
		{UserID: 99, AnimeID: 300, Watching: true},  // not a neighbor -> ignored
	}

	recs := scoreCandidates(neighbors, signals, mine, func(int64) bool { return false })
	require.Len(t, recs, 2)

	assert.EqualValues(t, 100, recs[0].AnimeID)
	assert.InDelta(t, 1.2, recs[0].Score, 1e-9)
	assert.Contains(t, recs[0].BecauseOf, int64(1), "explanation comes from shared taste titles")

	assert.EqualValues(t, 200, recs[1].AnimeID)
	assert.InDelta(t, 0.2*0.8*3, recs[1].Score, 1e-9)
}

func TestScoreCandidatesSeasonalBoost(t *testing.T) {
	mine := set(1)
	neighbors := []neighbor{{UserID: 10, Sim: 0.5, Taste: set(1)}}
	signals := []signal{
		{UserID: 10, AnimeID: 100, Watching: true}, // plain
		{UserID: 10, AnimeID: 200, Watching: true}, // seasonal
	}

	recs := scoreCandidates(neighbors, signals, mine, func(id int64) bool { return id == 200 })
	require.Len(t, recs, 2)
	assert.EqualValues(t, 200, recs[0].AnimeID, "seasonal titles outrank equal non-seasonal ones")
	assert.InDelta(t, 0.5*seasonalBoost, recs[0].Score, 1e-9)
}
