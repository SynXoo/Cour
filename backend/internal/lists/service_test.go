package lists

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"cour/internal/store/sqlcgen"
)

func i16(v int16) *int16 { return &v }
func i32(v int32) *int32 { return &v }
func ep(v int32) *int32  { return &v }

func TestResolveEntryClampsProgressToEpisodeCount(t *testing.T) {
	r := resolveEntry(sqlcgen.ListEntry{}, true, UpsertInput{
		Status:   sqlcgen.ListStatusWatching,
		Progress: i32(999),
	}, ep(12))
	assert.EqualValues(t, 12, r.Progress)
}

func TestResolveEntryAutoCompletesAtFinalEpisode(t *testing.T) {
	r := resolveEntry(sqlcgen.ListEntry{}, true, UpsertInput{
		Status:   sqlcgen.ListStatusWatching,
		Progress: i32(12),
	}, ep(12))
	assert.Equal(t, sqlcgen.ListStatusCompleted, r.Status)
	require.NotNil(t, r.FinishedOn, "completion stamps finished_on")
}

func TestResolveEntryCompletedFillsProgress(t *testing.T) {
	r := resolveEntry(sqlcgen.ListEntry{}, true, UpsertInput{
		Status: sqlcgen.ListStatusCompleted,
	}, ep(24))
	assert.EqualValues(t, 24, r.Progress)
	assert.NotNil(t, r.FinishedOn)
}

func TestResolveEntryWatchingStampsStartDateOnce(t *testing.T) {
	r := resolveEntry(sqlcgen.ListEntry{}, true, UpsertInput{Status: sqlcgen.ListStatusWatching}, ep(12))
	require.NotNil(t, r.StartedOn)

	// Existing start date is preserved on later updates.
	existing := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	r2 := resolveEntry(sqlcgen.ListEntry{
		Status: sqlcgen.ListStatusWatching, StartedOn: &existing, Progress: 3,
	}, false, UpsertInput{Status: sqlcgen.ListStatusWatching, Progress: i32(4)}, ep(12))
	require.NotNil(t, r2.StartedOn)
	assert.Equal(t, existing, *r2.StartedOn)
}

func TestResolveEntryScoreClearAndKeep(t *testing.T) {
	prior := sqlcgen.ListEntry{Status: sqlcgen.ListStatusWatching, Score: i16(7)}

	kept := resolveEntry(prior, false, UpsertInput{Status: sqlcgen.ListStatusWatching}, nil)
	require.NotNil(t, kept.Score)
	assert.EqualValues(t, 7, *kept.Score)

	cleared := resolveEntry(prior, false, UpsertInput{
		Status: sqlcgen.ListStatusWatching, Score: i16(0),
	}, nil)
	assert.Nil(t, cleared.Score)
}

func TestResolveEntryUnknownEpisodeCountNeverAutoCompletes(t *testing.T) {
	r := resolveEntry(sqlcgen.ListEntry{}, true, UpsertInput{
		Status:   sqlcgen.ListStatusWatching,
		Progress: i32(500),
	}, nil)
	assert.Equal(t, sqlcgen.ListStatusWatching, r.Status)
	assert.EqualValues(t, 500, r.Progress)
}

func activityTypes(acts []sqlcgen.InsertActivityParams) []sqlcgen.ActivityType {
	out := make([]sqlcgen.ActivityType, len(acts))
	for i, a := range acts {
		out[i] = a.Type
	}
	return out
}

func TestDiffActivities(t *testing.T) {
	watching := sqlcgen.ListEntry{Status: sqlcgen.ListStatusWatching, Progress: 3}

	t.Run("new entry emits list_add", func(t *testing.T) {
		acts := diffActivities(1, 2, sqlcgen.ListEntry{}, watching, true)
		assert.Equal(t, []sqlcgen.ActivityType{sqlcgen.ActivityTypeListAdd}, activityTypes(acts))
	})

	t.Run("new completed entry emits list_add + completed", func(t *testing.T) {
		done := sqlcgen.ListEntry{Status: sqlcgen.ListStatusCompleted}
		acts := diffActivities(1, 2, sqlcgen.ListEntry{}, done, true)
		assert.Equal(t, []sqlcgen.ActivityType{
			sqlcgen.ActivityTypeListAdd, sqlcgen.ActivityTypeCompleted,
		}, activityTypes(acts))
	})

	t.Run("status change emits status_change", func(t *testing.T) {
		paused := sqlcgen.ListEntry{Status: sqlcgen.ListStatusPaused, Progress: 3}
		acts := diffActivities(1, 2, watching, paused, false)
		assert.Equal(t, []sqlcgen.ActivityType{sqlcgen.ActivityTypeStatusChange}, activityTypes(acts))
	})

	t.Run("completion outranks status_change", func(t *testing.T) {
		done := sqlcgen.ListEntry{Status: sqlcgen.ListStatusCompleted, Progress: 12}
		acts := diffActivities(1, 2, watching, done, false)
		assert.Equal(t, []sqlcgen.ActivityType{sqlcgen.ActivityTypeCompleted}, activityTypes(acts))
	})

	t.Run("progress bump emits progress", func(t *testing.T) {
		bumped := sqlcgen.ListEntry{Status: sqlcgen.ListStatusWatching, Progress: 4}
		acts := diffActivities(1, 2, watching, bumped, false)
		assert.Equal(t, []sqlcgen.ActivityType{sqlcgen.ActivityTypeProgress}, activityTypes(acts))
	})

	t.Run("new score emits scored alongside progress", func(t *testing.T) {
		scored := sqlcgen.ListEntry{Status: sqlcgen.ListStatusWatching, Progress: 4, Score: i16(8)}
		acts := diffActivities(1, 2, watching, scored, false)
		assert.Equal(t, []sqlcgen.ActivityType{
			sqlcgen.ActivityTypeProgress, sqlcgen.ActivityTypeScored,
		}, activityTypes(acts))
	})

	t.Run("unchanged score emits nothing extra", func(t *testing.T) {
		before := sqlcgen.ListEntry{Status: sqlcgen.ListStatusWatching, Progress: 3, Score: i16(8)}
		after := sqlcgen.ListEntry{Status: sqlcgen.ListStatusWatching, Progress: 3, Score: i16(8)}
		acts := diffActivities(1, 2, before, after, false)
		assert.Empty(t, acts)
	})
}
