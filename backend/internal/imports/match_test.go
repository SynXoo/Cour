package imports

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/store/sqlcgen"
)

func testAnime(id int64, format string, year int) sqlcgen.Anime {
	a := sqlcgen.Anime{ID: id}
	if format != "" {
		f := sqlcgen.AnimeFormat(format)
		a.Format = &f
	}
	if year != 0 {
		y := int32(year)
		a.SeasonYear = &y
	}
	return a
}

func TestPickMatchGate(t *testing.T) {
	tv2023 := testAnime(1, "TV", 2023)
	movie2023 := testAnime(2, "MOVIE", 2023)
	tv2010 := testAnime(3, "TV", 2010)
	bare := testAnime(4, "", 0)

	t.Run("near-exact title stands alone", func(t *testing.T) {
		got, ok := pickMatch(Row{Title: "x"}, []candidate{{anime: bare, sim: 0.97}})
		require.True(t, ok)
		assert.Equal(t, int64(4), got.ID)
	})

	t.Run("0.90 alone is not enough", func(t *testing.T) {
		_, ok := pickMatch(Row{Title: "x"}, []candidate{{anime: bare, sim: 0.90}})
		assert.False(t, ok)
	})

	t.Run("0.90 with agreeing format is enough", func(t *testing.T) {
		got, ok := pickMatch(Row{Title: "x", Format: "TV"}, []candidate{{anime: tv2023, sim: 0.90}})
		require.True(t, ok)
		assert.Equal(t, int64(1), got.ID)
	})

	t.Run("0.90 with agreeing year is enough", func(t *testing.T) {
		_, ok := pickMatch(Row{Title: "x", Year: 2024}, []candidate{{anime: tv2023, sim: 0.90}})
		assert.True(t, ok, "±1 year counts as agreement")
	})

	t.Run("unknown source attributes neither help nor hurt", func(t *testing.T) {
		// MAL rows have no year: 0.90 + matching format still passes even
		// though the year can't be checked.
		_, ok := pickMatch(Row{Title: "x", Format: "TV"}, []candidate{{anime: tv2023, sim: 0.90}})
		assert.True(t, ok)
	})

	t.Run("format disagreement disqualifies outright", func(t *testing.T) {
		_, ok := pickMatch(Row{Title: "x", Format: "TV"}, []candidate{{anime: movie2023, sim: 0.99}})
		assert.False(t, ok, "a movie is not the TV series, however similar the title")
	})

	t.Run("year disagreement disqualifies outright", func(t *testing.T) {
		_, ok := pickMatch(Row{Title: "x", Year: 2023}, []candidate{{anime: tv2010, sim: 0.99}})
		assert.False(t, ok)
	})

	t.Run("photo finish goes to review", func(t *testing.T) {
		_, ok := pickMatch(Row{Title: "x"}, []candidate{
			{anime: tv2023, sim: 0.97},
			{anime: tv2010, sim: 0.94},
		})
		assert.False(t, ok, "0.03 margin is ambiguous — K-On! vs K-On!! territory")
	})

	t.Run("margin counts survivors only", func(t *testing.T) {
		got, ok := pickMatch(Row{Title: "x", Format: "TV"}, []candidate{
			{anime: tv2023, sim: 0.97},
			{anime: movie2023, sim: 0.95}, // disqualified: format disagrees
		})
		require.True(t, ok, "the movie was never a real contender")
		assert.Equal(t, int64(1), got.ID)
	})

	t.Run("no candidates, no match", func(t *testing.T) {
		_, ok := pickMatch(Row{Title: "x"}, nil)
		assert.False(t, ok)
	})
}

func TestFormatGroup(t *testing.T) {
	cases := map[string]string{
		"TV": "tv", "tv": "tv", "TV_SHORT": "tv",
		"MOVIE": "movie", "Movie": "movie",
		"OVA": "special", "ONA": "special", "Special": "special",
		"TV Special": "special", "TV_SPECIAL": "special", "PV": "special", "CM": "special",
		"MUSIC": "music", "Music": "music",
		"": "", "Unknown": "", "4-koma": "",
	}
	for in, want := range cases {
		assert.Equal(t, want, formatGroup(in), "input %q", in)
	}
}

func TestEntryParamsNormalization(t *testing.T) {
	count12 := int32(12)
	date := "2020-05-01"

	t.Run("completed fills progress to the count", func(t *testing.T) {
		p := entryParams(7, 9, Row{Status: sqlcgen.ListStatusCompleted, Progress: 5}, &count12)
		assert.Equal(t, int32(12), p.Progress)
		assert.Equal(t, sqlcgen.ListStatusCompleted, p.Status)
	})

	t.Run("progress clamps to the count", func(t *testing.T) {
		p := entryParams(7, 9, Row{Status: sqlcgen.ListStatusWatching, Progress: 99}, &count12)
		assert.Equal(t, int32(12), p.Progress)
		assert.Equal(t, sqlcgen.ListStatusWatching, p.Status, "no auto-complete for imported history")
	})

	t.Run("unknown count leaves progress alone", func(t *testing.T) {
		p := entryParams(7, 9, Row{Status: sqlcgen.ListStatusCompleted, Progress: 5}, nil)
		assert.Equal(t, int32(5), p.Progress)
	})

	t.Run("dates parse and junk drops", func(t *testing.T) {
		junk := "not-a-date"
		p := entryParams(7, 9, Row{Status: sqlcgen.ListStatusCompleted, StartedOn: &date, FinishedOn: &junk}, &count12)
		require.NotNil(t, p.StartedOn)
		assert.Equal(t, 2020, p.StartedOn.Year())
		assert.Nil(t, p.FinishedOn)
	})
}

func TestProcessTaskPayloadRoundTrip(t *testing.T) {
	task := NewProcessTask(42)
	assert.Equal(t, TaskProcess, task.Type())

	id, err := ParseProcessTask(task)
	require.NoError(t, err)
	assert.Equal(t, int64(42), id)
}
