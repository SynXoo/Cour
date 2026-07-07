// Package imports implements list import from AniList and MyAnimeList
// (docs/PHASE_2.md §M1): parse the source, match rows against the local
// catalog (source ids first, trigram title fallback, review bucket for the
// rest), preview, then bulk-apply in one transaction.
//
// The one inviolable rule lives in apply.go: the apply path writes NO
// activities. The activity spine feeds follower feeds and Trending Now, and
// a 900-entry import must not look like a 900-event evening.
package imports

import (
	"encoding/json"
	"errors"
	"time"

	"cour/internal/store/sqlcgen"
)

// maxRows caps one import job; bigger exports are almost certainly not real
// lists, and the preview payload has to stay servable.
const maxRows = 10000

// dateLayout is how entry dates are stored inside the rows jsonb.
const dateLayout = "2006-01-02"

var (
	ErrActiveImport = errors.New("imports: an import is already running")
	ErrNotFound     = errors.New("imports: job not found")
	ErrNotReady     = errors.New("imports: job is not ready to commit")
)

// BadInputError is a user-fixable problem (malformed file, unknown user,
// invalid resolution); handlers map it to a validation response rather than
// a 500.
type BadInputError struct{ Reason string }

func (e *BadInputError) Error() string { return "imports: " + e.Reason }

// Mode is the commit strategy.
type Mode string

const (
	// ModeMerge skips titles already on the local list.
	ModeMerge Mode = "merge"
	// ModeOverwrite lets the import win on status/score/progress.
	ModeOverwrite Mode = "overwrite"
)

// Match is how a row found (or failed to find) its target anime.
const (
	MatchID     = "id"     // source id hit the catalog directly
	MatchTitle  = "title"  // trigram fallback, auto-accepted
	MatchReview = "review" // needs manual resolution; skipped if unresolved
)

// Row is one source entry, normalized to Cour vocabulary at parse time and
// annotated by matching. The job's rows jsonb is exactly []Row; RowIndex for
// the API is the slice position, so order is part of the contract.
type Row struct {
	// Source identity; zero when the source lacks it.
	AniListID int    `json:"anilist_id,omitempty"`
	MALID     int    `json:"mal_id,omitempty"`
	Title     string `json:"title"`
	// Source-declared attributes, used to validate title-fallback matches.
	Format string `json:"format,omitempty"`
	Year   int    `json:"year,omitempty"`

	// Converted list state (Cour vocabulary; conversion rules in convert.go).
	Status     sqlcgen.ListStatus `json:"status"`
	Score      *int16             `json:"score,omitempty"`
	Progress   int32              `json:"progress,omitempty"`
	StartedOn  *string            `json:"started_on,omitempty"` // dateLayout
	FinishedOn *string            `json:"finished_on,omitempty"`

	// Matching outcome.
	Match   string `json:"match"`
	AnimeID int64  `json:"anime_id,omitempty"`
	OnList  bool   `json:"on_list,omitempty"` // already tracked at preview time
}

// Counts summarizes a job for the UI; stages fill in as they run.
type Counts struct {
	Total     int `json:"total"`
	Matched   int `json:"matched"`
	Review    int `json:"review"`
	Conflicts int `json:"conflicts"`
	Applied   int `json:"applied"`
	Skipped   int `json:"skipped"`
}

// DecodeRows unpacks a job's rows column; a null column is an empty slice.
func DecodeRows(raw []byte) ([]Row, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var rows []Row
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// DecodeCounts unpacks the counts column; corrupt or empty yields zeros.
func DecodeCounts(raw []byte) Counts {
	var c Counts
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &c)
	}
	return c
}

func encode(v any) []byte {
	raw, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return raw
}

// ParseEntryDate turns a stored row date back into a time; nil or malformed
// stays nil (dates are optional history, never worth failing an apply over).
func ParseEntryDate(s *string) *time.Time {
	if s == nil {
		return nil
	}
	t, err := time.Parse(dateLayout, *s)
	if err != nil {
		return nil
	}
	return &t
}
