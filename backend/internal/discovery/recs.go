package discovery

import (
	"context"
	"fmt"
	"sort"
	"time"

	"cour/internal/store/sqlcgen"
)

// Recommendations: neighbor users by taste overlap (Jaccard over
// favorites ∪ high scores), aggregate what they're watching or recently
// rated highly, bias toward the current/previous season, and keep each
// suggestion explainable via the shared titles that produced it.

const (
	recsCacheTTL     = 6 * time.Hour
	topNeighbors     = 25
	recsLimit        = 24
	recentSignalDays = 90
	seasonalBoost    = 1.5
)

type Recommendation struct {
	AnimeID   int64
	Score     float64
	BecauseOf []int64 // shared taste anime ids behind the suggestion
}

// jaccard computes |a∩b| / |a∪b| for id sets.
func jaccard(a, b map[int64]bool) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	inter := 0
	small, large := a, b
	if len(b) < len(a) {
		small, large = b, a
	}
	for id := range small {
		if large[id] {
			inter++
		}
	}
	union := len(a) + len(b) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

type neighbor struct {
	UserID int64
	Sim    float64
	Taste  map[int64]bool
}

// rankNeighbors computes similarities and returns the strongest first.
func rankNeighbors(mine map[int64]bool, tasteRows map[int64]map[int64]bool, limit int) []neighbor {
	out := make([]neighbor, 0, len(tasteRows))
	for userID, taste := range tasteRows {
		if sim := jaccard(mine, taste); sim > 0 {
			out = append(out, neighbor{UserID: userID, Sim: sim, Taste: taste})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Sim != out[j].Sim {
			return out[i].Sim > out[j].Sim
		}
		return out[i].UserID < out[j].UserID
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

type signal struct {
	UserID   int64
	AnimeID  int64
	Watching bool
	Score    *int16
}

// scoreCandidates aggregates neighbor signals into per-anime scores with
// explanations. seasonal reports whether an anime is current/last season.
func scoreCandidates(neighbors []neighbor, signals []signal, mine map[int64]bool, seasonal func(int64) bool) []Recommendation {
	simOf := make(map[int64]neighbor, len(neighbors))
	for _, n := range neighbors {
		simOf[n.UserID] = n
	}

	type agg struct {
		score   float64
		because map[int64]float64 // shared taste anime -> contribution weight
	}
	byAnime := map[int64]*agg{}

	for _, sig := range signals {
		n, ok := simOf[sig.UserID]
		if !ok {
			continue
		}
		w := 0.0
		if sig.Watching {
			w = 1.0
		}
		if sig.Score != nil && *sig.Score >= 8 {
			if sw := 0.8 * float64(*sig.Score-7); sw > w {
				w = sw
			}
		}
		if w == 0 {
			continue
		}

		a := byAnime[sig.AnimeID]
		if a == nil {
			a = &agg{because: map[int64]float64{}}
			byAnime[sig.AnimeID] = a
		}
		contribution := n.Sim * w
		a.score += contribution
		// Remember which of MY taste titles this neighbor shares — those are
		// the "because you liked X" candidates.
		for id := range n.Taste {
			if mine[id] {
				a.because[id] += contribution
			}
		}
	}

	out := make([]Recommendation, 0, len(byAnime))
	for animeID, a := range byAnime {
		score := a.score
		if seasonal(animeID) {
			score *= seasonalBoost
		}
		out = append(out, Recommendation{
			AnimeID:   animeID,
			Score:     score,
			BecauseOf: topReasons(a.because, 2),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].AnimeID < out[j].AnimeID
	})
	if len(out) > recsLimit {
		out = out[:recsLimit]
	}
	return out
}

func topReasons(weights map[int64]float64, n int) []int64 {
	type kv struct {
		id int64
		w  float64
	}
	pairs := make([]kv, 0, len(weights))
	for id, w := range weights {
		pairs = append(pairs, kv{id, w})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].w != pairs[j].w {
			return pairs[i].w > pairs[j].w
		}
		return pairs[i].id < pairs[j].id
	})
	if len(pairs) > n {
		pairs = pairs[:n]
	}
	out := make([]int64, len(pairs))
	for i, p := range pairs {
		out[i] = p.id
	}
	return out
}

// RecItem is a hydrated recommendation ready for the API layer.
type RecItem struct {
	Anime   sqlcgen.Anime
	Reasons []string
}

func recsKey(userID int64) string { return fmt.Sprintf("recs:v1:%d", userID) }

// Recommendations computes (or serves cached) suggestions for a user.
// Cold start (no taste signal) falls back to trending ⊎ hidden gems.
func (s *Service) Recommendations(ctx context.Context, userID int64) ([]RecItem, bool, error) {
	var cached []RecItem
	if found, err := s.cache.GetJSON(ctx, recsKey(userID), &cached); err == nil && found {
		return cached, false, nil
	}

	tasteIDs, err := s.q.TasteSet(ctx, userID)
	if err != nil {
		return nil, false, fmt.Errorf("taste set: %w", err)
	}

	if len(tasteIDs) == 0 {
		items, err := s.coldStart(ctx)
		return items, true, err
	}

	mine := make(map[int64]bool, len(tasteIDs))
	for _, id := range tasteIDs {
		mine[id] = true
	}

	candidateUsers, err := s.candidateNeighborIDs(ctx, tasteIDs, userID)
	if err != nil {
		return nil, false, err
	}
	if len(candidateUsers) == 0 {
		items, err := s.coldStart(ctx)
		return items, true, err
	}
	tastes, err := s.tasteSetsFor(ctx, candidateUsers)
	if err != nil {
		return nil, false, err
	}
	neighbors := rankNeighbors(mine, tastes, topNeighbors)

	if len(neighbors) == 0 {
		items, err := s.coldStart(ctx)
		return items, true, err
	}

	neighborIDs := make([]int64, len(neighbors))
	for i, n := range neighbors {
		neighborIDs[i] = n.UserID
	}
	since := time.Now().Add(-recentSignalDays * 24 * time.Hour)
	signalRows, err := s.q.NeighborSignals(ctx, sqlcgen.NeighborSignalsParams{
		Column1:   neighborIDs,
		UpdatedAt: since,
		UserID:    userID,
	})
	if err != nil {
		return nil, false, fmt.Errorf("neighbor signals: %w", err)
	}
	signals := make([]signal, len(signalRows))
	candidateIDs := make([]int64, 0, len(signalRows))
	for i, row := range signalRows {
		signals[i] = signal{
			UserID:   row.UserID,
			AnimeID:  row.AnimeID,
			Watching: row.Status == sqlcgen.ListStatusWatching,
			Score:    row.Score,
		}
		candidateIDs = append(candidateIDs, row.AnimeID)
	}

	// Seasonal bias needs season info for candidates (and titles for reasons).
	seasonalSet, animeByID, err := s.seasonalLookup(ctx, append(candidateIDs, tasteIDs...))
	if err != nil {
		return nil, false, err
	}

	recs := scoreCandidates(neighbors, signals, mine, func(id int64) bool { return seasonalSet[id] })

	items := make([]RecItem, 0, len(recs))
	for _, rec := range recs {
		anime, ok := animeByID[rec.AnimeID]
		if !ok {
			continue
		}
		reasons := make([]string, 0, len(rec.BecauseOf)+1)
		for _, id := range rec.BecauseOf {
			if a, ok := animeByID[id]; ok {
				reasons = append(reasons, "Because you liked "+displayTitle(a))
			}
		}
		if len(reasons) == 0 {
			reasons = append(reasons, "Users with your taste are watching this")
		}
		items = append(items, RecItem{Anime: anime, Reasons: reasons})
	}

	if err := s.cache.SetJSON(ctx, recsKey(userID), items, recsCacheTTL); err != nil {
		s.log.Warn("recs cache write failed", "err", err)
	}
	return items, false, nil
}

// candidateNeighborIDs unions the favorites- and high-score-based candidate
// pools (two queries because sqlc can't analyze derived-table UNIONs).
func (s *Service) candidateNeighborIDs(ctx context.Context, tasteIDs []int64, userID int64) ([]int64, error) {
	favs, err := s.q.FavoriteNeighborIDs(ctx, sqlcgen.FavoriteNeighborIDsParams{Column1: tasteIDs, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("favorite neighbors: %w", err)
	}
	scored, err := s.q.HighScoreNeighborIDs(ctx, sqlcgen.HighScoreNeighborIDsParams{Column1: tasteIDs, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("high-score neighbors: %w", err)
	}
	seen := map[int64]bool{}
	out := make([]int64, 0, len(favs)+len(scored))
	for _, id := range append(favs, scored...) {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out, nil
}

// tasteSetsFor loads the candidates' taste sets (favorites ∪ high scores).
func (s *Service) tasteSetsFor(ctx context.Context, userIDs []int64) (map[int64]map[int64]bool, error) {
	favRows, err := s.q.FavoriteRowsForUsers(ctx, userIDs)
	if err != nil {
		return nil, fmt.Errorf("favorite rows: %w", err)
	}
	scoreRows, err := s.q.HighScoreRowsForUsers(ctx, userIDs)
	if err != nil {
		return nil, fmt.Errorf("high-score rows: %w", err)
	}

	tastes := map[int64]map[int64]bool{}
	add := func(userID, animeID int64) {
		if tastes[userID] == nil {
			tastes[userID] = map[int64]bool{}
		}
		tastes[userID][animeID] = true
	}
	for _, r := range favRows {
		add(r.UserID, r.AnimeID)
	}
	for _, r := range scoreRows {
		add(r.UserID, r.AnimeID)
	}
	return tastes, nil
}

// coldStart: trending blended with hidden gems, labeled honestly.
func (s *Service) coldStart(ctx context.Context) ([]RecItem, error) {
	trending, _, err := s.Trending(ctx, 12)
	if err != nil {
		return nil, err
	}
	gems, err := s.HiddenGems(ctx)
	if err != nil {
		return nil, err
	}

	items := make([]RecItem, 0, recsLimit)
	seen := map[int64]bool{}
	for _, a := range trending {
		if !seen[a.ID] {
			seen[a.ID] = true
			items = append(items, RecItem{Anime: a, Reasons: []string{"Trending on Cour right now"}})
		}
	}
	for _, a := range gems {
		if len(items) >= recsLimit {
			break
		}
		if !seen[a.ID] {
			seen[a.ID] = true
			items = append(items, RecItem{Anime: a, Reasons: []string{"A hidden gem this season"}})
		}
	}
	return items, nil
}

// seasonalLookup hydrates anime rows and reports which are current/previous
// season.
func (s *Service) seasonalLookup(ctx context.Context, ids []int64) (map[int64]bool, map[int64]sqlcgen.Anime, error) {
	dedup := map[int64]bool{}
	unique := make([]int64, 0, len(ids))
	for _, id := range ids {
		if !dedup[id] {
			dedup[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return map[int64]bool{}, map[int64]sqlcgen.Anime{}, nil
	}
	rows, err := s.q.ListAnimeByIDs(ctx, unique)
	if err != nil {
		return nil, nil, fmt.Errorf("hydrate candidates: %w", err)
	}

	now := time.Now()
	curSeason, curYear := currentSeason(now)
	prevSeason, prevYear := previousSeason(curSeason, curYear)

	seasonal := map[int64]bool{}
	byID := map[int64]sqlcgen.Anime{}
	for _, a := range rows {
		byID[a.ID] = a
		if a.Season != nil && a.SeasonYear != nil {
			s, y := string(*a.Season), int(*a.SeasonYear)
			if (s == curSeason && y == curYear) || (s == prevSeason && y == prevYear) {
				seasonal[a.ID] = true
			}
		}
	}
	return seasonal, byID, nil
}

func displayTitle(a sqlcgen.Anime) string {
	if a.TitleEnglish != nil && *a.TitleEnglish != "" {
		return *a.TitleEnglish
	}
	return a.TitleRomaji
}

func currentSeason(t time.Time) (string, int) {
	switch {
	case t.Month() <= 3:
		return "WINTER", t.Year()
	case t.Month() <= 6:
		return "SPRING", t.Year()
	case t.Month() <= 9:
		return "SUMMER", t.Year()
	default:
		return "FALL", t.Year()
	}
}

func previousSeason(season string, year int) (string, int) {
	switch season {
	case "WINTER":
		return "FALL", year - 1
	case "SPRING":
		return "WINTER", year
	case "SUMMER":
		return "SPRING", year
	default:
		return "SUMMER", year
	}
}
