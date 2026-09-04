package pulse

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func d(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestStreakCountsBackFromToday(t *testing.T) {
	s := computeStreak([]time.Time{d("2026-09-04"), d("2026-09-03"), d("2026-09-02"), d("2026-08-30")}, d("2026-09-04"))
	assert.Equal(t, 3, s.Current)
	assert.True(t, s.ActiveToday)
	assert.Equal(t, 3, s.Best)
	// oldest → today: 08-29 08-30 08-31 09-01 09-02 09-03 09-04
	assert.Equal(t, [7]bool{false, true, false, false, true, true, true}, s.Week)
}

func TestStreakSurvivesAnUnfinishedToday(t *testing.T) {
	// Active yesterday and the day before, nothing yet today: the run is
	// alive (the home is where you'd extend it), just not marked today.
	s := computeStreak([]time.Time{d("2026-09-03"), d("2026-09-02")}, d("2026-09-04"))
	assert.Equal(t, 2, s.Current)
	assert.False(t, s.ActiveToday)
}

func TestStreakBreaksAfterAMissedDay(t *testing.T) {
	s := computeStreak([]time.Time{d("2026-09-02"), d("2026-09-01")}, d("2026-09-04"))
	assert.Equal(t, 0, s.Current)
	assert.Equal(t, 2, s.Best, "best remembers the old run")
}

func TestStreakBestIsLongestRunEver(t *testing.T) {
	days := []time.Time{
		d("2026-09-04"),
		d("2026-08-10"), d("2026-08-11"), d("2026-08-12"), d("2026-08-13"), d("2026-08-14"),
	}
	s := computeStreak(days, d("2026-09-04"))
	assert.Equal(t, 1, s.Current)
	assert.Equal(t, 5, s.Best)
}

func TestStreakIgnoresTimeOfDayAndDuplicates(t *testing.T) {
	days := []time.Time{
		time.Date(2026, 9, 4, 23, 50, 0, 0, time.UTC),
		time.Date(2026, 9, 4, 1, 0, 0, 0, time.UTC),
		time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC),
	}
	s := computeStreak(days, time.Date(2026, 9, 4, 8, 0, 0, 0, time.UTC))
	assert.Equal(t, 2, s.Current)
}

func TestEmptyStreak(t *testing.T) {
	s := computeStreak(nil, d("2026-09-04"))
	assert.Equal(t, Streak{}, s)
}

func TestBadgesEarnedAndNext(t *testing.T) {
	earned, next := evaluateBadges(counters{Comments: 12, Completed: 5, BestStreak: 4, Favorites: 2})
	ids := make([]string, len(earned))
	for i, b := range earned {
		ids[i] = b.ID
	}
	assert.Equal(t, []string{"first_word", "regular", "three_nights", "finisher"}, ids, "catalog order, thresholds inclusive")

	require.NotNil(t, next)
	// 4/7 nights (0.57) beats 12/50 comments (0.24), 5/25 completed (0.2),
	// 2/5 favorites (0.4).
	assert.Equal(t, "seven_nights", next.ID)
	assert.Equal(t, 4, next.Progress)
	assert.Equal(t, 7, next.Target)
}

func TestNextBadgeOnAFreshAccountIsTheCheapest(t *testing.T) {
	earned, next := evaluateBadges(counters{})
	assert.Empty(t, earned)
	require.NotNil(t, next)
	// Every ratio is 0; the tie goes to the smallest target, and among
	// target-1 badges the first in catalog order wins.
	assert.Equal(t, "first_word", next.ID)
}

func TestNextIsNilWhenEverythingIsEarned(t *testing.T) {
	_, next := evaluateBadges(counters{
		Comments: 100, ShowsDiscussed: 20, Completed: 50, Favorites: 9, Reviews: 3,
		NightComments: 5, EarlyComments: 5, ReactionsReceived: 40, BestStreak: 40,
	})
	assert.Nil(t, next)
}

func TestSnippet(t *testing.T) {
	assert.Equal(t, "short", snippet("short"))
	long := make([]rune, 200)
	for i := range long {
		long[i] = 'あ'
	}
	out := []rune(snippet(string(long)))
	assert.Len(t, out, snippetRunes)
	assert.Equal(t, '…', out[len(out)-1])
}
