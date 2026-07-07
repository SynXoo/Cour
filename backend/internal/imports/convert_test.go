package imports

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/anilist"
	"cour/internal/store/sqlcgen"
)

func TestConvertMALStatus(t *testing.T) {
	cases := []struct {
		in   string
		want sqlcgen.ListStatus
		ok   bool
	}{
		{"Watching", sqlcgen.ListStatusWatching, true},
		{"Completed", sqlcgen.ListStatusCompleted, true},
		{"On-Hold", sqlcgen.ListStatusPaused, true},
		{"Dropped", sqlcgen.ListStatusDropped, true},
		{"Plan to Watch", sqlcgen.ListStatusPlanning, true},
		{"  plan to watch  ", sqlcgen.ListStatusPlanning, true},
		// Legacy numeric exports (5 was never assigned).
		{"1", sqlcgen.ListStatusWatching, true},
		{"2", sqlcgen.ListStatusCompleted, true},
		{"3", sqlcgen.ListStatusPaused, true},
		{"4", sqlcgen.ListStatusDropped, true},
		{"6", sqlcgen.ListStatusPlanning, true},
		{"5", "", false},
		{"Rewatching", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := ConvertMALStatus(c.in)
		assert.Equal(t, c.ok, ok, "input %q", c.in)
		if c.ok {
			assert.Equal(t, c.want, got, "input %q", c.in)
		}
	}
}

func TestConvertAniListStatus(t *testing.T) {
	cases := []struct {
		in   string
		want sqlcgen.ListStatus
		ok   bool
	}{
		{"CURRENT", sqlcgen.ListStatusWatching, true},
		{"PLANNING", sqlcgen.ListStatusPlanning, true},
		{"COMPLETED", sqlcgen.ListStatusCompleted, true},
		{"DROPPED", sqlcgen.ListStatusDropped, true},
		{"PAUSED", sqlcgen.ListStatusPaused, true},
		// No rewatch concept — a rewatcher has finished the show.
		{"REPEATING", sqlcgen.ListStatusCompleted, true},
		{"current", sqlcgen.ListStatusWatching, true},
		{"BINGEING", "", false},
	}
	for _, c := range cases {
		got, ok := ConvertAniListStatus(c.in)
		assert.Equal(t, c.ok, ok, "input %q", c.in)
		if c.ok {
			assert.Equal(t, c.want, got, "input %q", c.in)
		}
	}
}

func TestConvertMALScore(t *testing.T) {
	assert.Nil(t, ConvertMALScore(0))
	assert.Nil(t, ConvertMALScore(-3))
	for raw := 1; raw <= 10; raw++ {
		got := ConvertMALScore(raw)
		require.NotNil(t, got)
		assert.Equal(t, int16(raw), *got)
	}
	got := ConvertMALScore(11) // corrupt exports exist; stay in range
	require.NotNil(t, got)
	assert.Equal(t, int16(10), *got)
}

func TestConvertAniListScore(t *testing.T) {
	cases := []struct {
		format string
		raw    float64
		want   int16 // 0 = expect unscored
	}{
		{"POINT_100", 0, 0},
		{"POINT_100", 85, 9}, // 8.5 rounds half away from zero
		{"POINT_100", 84, 8},
		{"POINT_100", 100, 10},
		{"POINT_100", 4, 1}, // a terrible score is still a score, never rounds to unscored
		{"POINT_10_DECIMAL", 7.6, 8},
		{"POINT_10_DECIMAL", 7.4, 7},
		{"POINT_10_DECIMAL", 0, 0},
		{"POINT_10", 7, 7},
		{"POINT_10", 10, 10},
		{"POINT_5", 4, 8},
		{"POINT_5", 5, 10},
		{"POINT_5", 1, 2},
		{"POINT_3", 1, 3},
		{"POINT_3", 2, 6},
		{"POINT_3", 3, 9},
		// Formats AniList hasn't invented yet degrade to round+clamp.
		{"POINT_42", 7, 7},
		{"POINT_42", 999, 10},
	}
	for _, c := range cases {
		got := ConvertAniListScore(c.format, c.raw)
		if c.want == 0 {
			assert.Nil(t, got, "%s %v", c.format, c.raw)
			continue
		}
		require.NotNil(t, got, "%s %v", c.format, c.raw)
		assert.Equal(t, c.want, *got, "%s %v", c.format, c.raw)
	}
}

func TestRowsFromAniList(t *testing.T) {
	english := "Frieren: Beyond Journey's End"
	format := "TV"
	year := 2023
	mal := 52991
	list := anilist.UserList{
		ScoreFormat: "POINT_100",
		Entries: []anilist.UserListEntry{
			{
				Status:      "REPEATING",
				Score:       92,
				Progress:    17,
				StartedAt:   anilist.FuzzyDate{Year: 2023, Month: 10, Day: 5},
				CompletedAt: anilist.FuzzyDate{Year: 2024}, // partial → dropped, not invented
				Media: anilist.UserListMedia{
					ID: 154587, IDMal: &mal,
					Title:  anilist.Title{Romaji: "Sousou no Frieren", English: &english},
					Format: &format, SeasonYear: &year,
				},
			},
			{Status: "MEDITATING", Media: anilist.UserListMedia{ID: 1}}, // unknown status dropped
			{
				Status: "PLANNING",
				Media:  anilist.UserListMedia{ID: 2, Title: anilist.Title{English: &english}},
			},
		},
	}

	rows := RowsFromAniList(list)
	require.Len(t, rows, 2)

	r := rows[0]
	assert.Equal(t, 154587, r.AniListID)
	assert.Equal(t, 52991, r.MALID)
	assert.Equal(t, "Sousou no Frieren", r.Title)
	assert.Equal(t, "TV", r.Format)
	assert.Equal(t, 2023, r.Year)
	assert.Equal(t, sqlcgen.ListStatusCompleted, r.Status, "REPEATING → completed")
	require.NotNil(t, r.Score)
	assert.Equal(t, int16(9), *r.Score)
	assert.Equal(t, int32(17), r.Progress)
	require.NotNil(t, r.StartedOn)
	assert.Equal(t, "2023-10-05", *r.StartedOn)
	assert.Nil(t, r.FinishedOn, "partial fuzzy date must not be invented")
	assert.Equal(t, MatchReview, r.Match, "rows start unmatched")

	assert.Equal(t, english, rows[1].Title, "romaji missing falls back to english")
	assert.Nil(t, rows[1].Score)
}
