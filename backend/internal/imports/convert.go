package imports

// Score and status conversion, per the mapping table in docs/PHASE_2.md §M1.
// Pure functions — this is the part of an importer that silently corrupts a
// decade of list history when it's wrong, so it stays trivially testable.

import (
	"fmt"
	"math"
	"strings"

	"cour/internal/anilist"
	"cour/internal/store/sqlcgen"
)

// malStatuses maps MAL export statuses to Cour's. Current exports use the
// text form; ancient ones used numeric codes (5 was never assigned).
var malStatuses = map[string]sqlcgen.ListStatus{
	"watching": sqlcgen.ListStatusWatching, "1": sqlcgen.ListStatusWatching,
	"completed": sqlcgen.ListStatusCompleted, "2": sqlcgen.ListStatusCompleted,
	"on-hold": sqlcgen.ListStatusPaused, "3": sqlcgen.ListStatusPaused,
	"dropped": sqlcgen.ListStatusDropped, "4": sqlcgen.ListStatusDropped,
	"plan to watch": sqlcgen.ListStatusPlanning, "6": sqlcgen.ListStatusPlanning,
}

// ConvertMALStatus maps a MAL status (text or legacy numeric) to Cour's.
func ConvertMALStatus(s string) (sqlcgen.ListStatus, bool) {
	st, ok := malStatuses[strings.ToLower(strings.TrimSpace(s))]
	return st, ok
}

// anilistStatuses: REPEATING maps to completed — Cour has no rewatch
// concept, and a rewatcher has by definition finished the show; dropping
// the entry would lose the completion.
var anilistStatuses = map[string]sqlcgen.ListStatus{
	"CURRENT":   sqlcgen.ListStatusWatching,
	"PLANNING":  sqlcgen.ListStatusPlanning,
	"COMPLETED": sqlcgen.ListStatusCompleted,
	"DROPPED":   sqlcgen.ListStatusDropped,
	"PAUSED":    sqlcgen.ListStatusPaused,
	"REPEATING": sqlcgen.ListStatusCompleted,
}

// ConvertAniListStatus maps an AniList MediaListStatus to Cour's.
func ConvertAniListStatus(s string) (sqlcgen.ListStatus, bool) {
	st, ok := anilistStatuses[strings.ToUpper(strings.TrimSpace(s))]
	return st, ok
}

// ConvertMALScore maps MAL's 1-10 straight across; 0 means unscored.
func ConvertMALScore(raw int) *int16 {
	if raw <= 0 {
		return nil
	}
	return clampScore(float64(raw))
}

// ConvertAniListScore converts a raw score in the user's score format to
// Cour's 1-10. Zero and negative are unscored in every format. Nonzero
// scores never round away to unscored — a 4/100 is a strong opinion, not a
// missing one — so the result clamps into [1, 10].
func ConvertAniListScore(format string, raw float64) *int16 {
	if raw <= 0 {
		return nil
	}
	switch format {
	case "POINT_100":
		return clampScore(raw / 10)
	case "POINT_5":
		return clampScore(raw * 2)
	case "POINT_3":
		// Smileys: bad/neutral/good → low/mid/high.
		return clampScore(raw * 3)
	default:
		// POINT_10, POINT_10_DECIMAL, and any format AniList adds later:
		// already (roughly) tens — round and clamp.
		return clampScore(raw)
	}
}

func clampScore(v float64) *int16 {
	s := int16(math.Round(v))
	if s < 1 {
		s = 1
	}
	if s > 10 {
		s = 10
	}
	return &s
}

// RowsFromAniList converts a fetched AniList list into rows ready for
// matching. Entries with statuses Cour can't represent are dropped (AniList
// adding one shouldn't fail a whole import). Partial fuzzy dates are
// dropped rather than invented.
func RowsFromAniList(list anilist.UserList) []Row {
	rows := make([]Row, 0, len(list.Entries))
	for _, e := range list.Entries {
		status, ok := ConvertAniListStatus(e.Status)
		if !ok {
			continue
		}
		title := strings.TrimSpace(e.Media.Title.Romaji)
		if title == "" && e.Media.Title.English != nil {
			title = strings.TrimSpace(*e.Media.Title.English)
		}
		row := Row{
			AniListID:  e.Media.ID,
			Title:      title,
			Status:     status,
			Score:      ConvertAniListScore(list.ScoreFormat, e.Score),
			Progress:   int32(max(e.Progress, 0)),
			StartedOn:  fuzzyDate(e.StartedAt),
			FinishedOn: fuzzyDate(e.CompletedAt),
			Match:      MatchReview,
		}
		if e.Media.IDMal != nil {
			row.MALID = *e.Media.IDMal
		}
		if e.Media.Format != nil {
			row.Format = *e.Media.Format
		}
		if e.Media.SeasonYear != nil {
			row.Year = *e.Media.SeasonYear
		}
		rows = append(rows, row)
	}
	return rows
}

func fuzzyDate(d anilist.FuzzyDate) *string {
	if d.Year == 0 || d.Month == 0 || d.Day == 0 {
		return nil
	}
	s := fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day)
	return &s
}
