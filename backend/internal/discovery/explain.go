package discovery

// Explained trending (§M3.8): the same ranking as Trending, with the
// activity that earned each rank and — for a signed-in viewer — the reasons
// relative to them. The trending page used to be a 60-poster wall with no
// argument; this is the argument.

import (
	"context"
	"fmt"
	"time"

	"cour/internal/store/sqlcgen"
)

const (
	// How many followee names to name before "+N".
	maxFolloweeNames = 3
	// How many shared genres to cite; past two it reads as a tag dump.
	maxSharedGenres = 2
	// The viewer's top genres considered for overlap.
	topGenresConsidered = 5
	// Gems drop anything inside this much of the trending ranking.
	gemsExcludeTrendingTop = 50
)

// Signals are per-type activity counts inside the trending window.
type Signals struct {
	Comments  int
	ListAdds  int
	Completed int
	Favorites int
	Reviews   int
	Scored    int
}

// You is the viewer-relative half of the explanation.
type You struct {
	Status         *sqlcgen.ListStatus
	Followees      []string
	FolloweesCount int
	SharedGenres   []string
}

type Explained struct {
	Anime   sqlcgen.Anime
	Rank    int
	Signals Signals
	You     *You
}

func addSignal(s *Signals, t sqlcgen.ActivityType, n int) {
	switch t {
	case sqlcgen.ActivityTypeComment:
		s.Comments += n
	case sqlcgen.ActivityTypeListAdd:
		s.ListAdds += n
	case sqlcgen.ActivityTypeCompleted:
		s.Completed += n
	case sqlcgen.ActivityTypeFavorite:
		s.Favorites += n
	case sqlcgen.ActivityTypeReview:
		s.Reviews += n
	case sqlcgen.ActivityTypeScored:
		s.Scored += n
	}
}

// sharedGenres keeps the title's genres that appear in the viewer's top
// list, in the *viewer's* order (their biggest genre first), capped.
func sharedGenres(animeGenres, viewerTop []string, limit int) []string {
	has := make(map[string]bool, len(animeGenres))
	for _, g := range animeGenres {
		has[g] = true
	}
	out := []string{}
	for _, g := range viewerTop {
		if len(out) >= limit {
			break
		}
		if has[g] {
			out = append(out, g)
		}
	}
	return out
}

// Explain ranks like Trending and annotates. userID nil = anonymous caller.
func (s *Service) Explain(ctx context.Context, limit int, userID *int64) ([]Explained, time.Time, error) {
	list, computedAt, err := s.Trending(ctx, limit)
	if err != nil {
		return nil, time.Time{}, err
	}
	if len(list) == 0 {
		return []Explained{}, computedAt, nil
	}
	ids := make([]int64, len(list))
	for i, a := range list {
		ids[i] = a.ID
	}

	sigRows, err := s.q.ActivitySignals(ctx, sqlcgen.ActivitySignalsParams{
		AnimeIds: ids,
		Since:    time.Now().Add(-s.cfg.Window),
	})
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("signals: %w", err)
	}
	signals := make(map[int64]*Signals, len(ids))
	for _, r := range sigRows {
		if r.AnimeID == nil {
			continue
		}
		sig := signals[*r.AnimeID]
		if sig == nil {
			sig = &Signals{}
			signals[*r.AnimeID] = sig
		}
		addSignal(sig, r.Type, int(r.Count))
	}

	out := make([]Explained, len(list))
	for i, a := range list {
		out[i] = Explained{Anime: a, Rank: i + 1}
		if sig := signals[a.ID]; sig != nil {
			out[i].Signals = *sig
		}
	}
	if userID == nil {
		return out, computedAt, nil
	}

	statusRows, err := s.q.UserListStatusFor(ctx, sqlcgen.UserListStatusForParams{UserID: *userID, AnimeIds: ids})
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("viewer statuses: %w", err)
	}
	status := make(map[int64]sqlcgen.ListStatus, len(statusRows))
	for _, r := range statusRows {
		status[r.AnimeID] = r.Status
	}

	folRows, err := s.q.FolloweesOnList(ctx, sqlcgen.FolloweesOnListParams{UserID: *userID, AnimeIds: ids})
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("followees: %w", err)
	}
	followees := make(map[int64][]string, len(ids))
	for _, r := range folRows {
		followees[r.AnimeID] = append(followees[r.AnimeID], r.Username)
	}

	genreRows, err := s.q.UserGenreBreakdown(ctx, *userID)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("viewer genres: %w", err)
	}
	top := make([]string, 0, topGenresConsidered)
	for i, g := range genreRows {
		if i >= topGenresConsidered {
			break
		}
		top = append(top, g.Genre)
	}

	for i := range out {
		id := out[i].Anime.ID
		you := &You{
			Followees:      []string{},
			SharedGenres:   sharedGenres(out[i].Anime.Genres, top, maxSharedGenres),
			FolloweesCount: len(followees[id]),
		}
		if st, ok := status[id]; ok {
			st := st
			you.Status = &st
		}
		names := followees[id]
		if len(names) > maxFolloweeNames {
			names = names[:maxFolloweeNames]
		}
		if names != nil {
			you.Followees = names
		}
		out[i].You = you
	}
	return out, computedAt, nil
}
