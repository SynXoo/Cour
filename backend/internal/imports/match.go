package imports

// Matching: source ids first (near-total hit rate — the catalog is an
// AniList mirror and carries mal_id since M1.1), trigram title fallback for
// the rest, and a review bucket for anything the fallback can't take
// responsibility for. A wrong auto-match silently corrupts a list, so the
// gate is deliberately conservative: borderline goes to review, where the
// UI's search picker costs the user two clicks.

import (
	"context"
	"fmt"
	"strings"

	"cour/internal/store/sqlcgen"
)

const (
	// titleCandidates per fallback lookup; enough for the margin rule to see
	// the runner-up.
	titleCandidates = 5

	// simAutoAccept: near-exact titles stand on their own.
	simAutoAccept = 0.95
	// simAssisted: enough when format or year actively corroborates.
	simAssisted = 0.88
	// simMargin: the winner must clear the runner-up by this much;
	// photo-finishes between two catalog titles go to review.
	simMargin = 0.05
)

// matchRows annotates rows in place with match outcomes and flags the ones
// already on the user's list, then returns the preview counts.
func (s *Service) matchRows(ctx context.Context, userID int64, source sqlcgen.ImportSource, rows []Row) (Counts, error) {
	if err := s.matchByID(ctx, source, rows); err != nil {
		return Counts{}, err
	}
	for i := range rows {
		if rows[i].AnimeID != 0 || rows[i].Title == "" {
			continue
		}
		cands, err := s.titleCandidates(ctx, rows[i].Title)
		if err != nil {
			return Counts{}, fmt.Errorf("title match %q: %w", rows[i].Title, err)
		}
		if anime, ok := pickMatch(rows[i], cands); ok {
			rows[i].AnimeID = anime.ID
			rows[i].Match = MatchTitle
		}
	}

	tracked, err := s.q.ListEntryAnimeIDs(ctx, userID)
	if err != nil {
		return Counts{}, fmt.Errorf("list entry ids: %w", err)
	}
	onList := make(map[int64]bool, len(tracked))
	for _, id := range tracked {
		onList[id] = true
	}

	counts := Counts{Total: len(rows)}
	for i := range rows {
		if rows[i].AnimeID == 0 {
			rows[i].Match = MatchReview
			counts.Review++
			continue
		}
		counts.Matched++
		if onList[rows[i].AnimeID] {
			rows[i].OnList = true
			counts.Conflicts++
		}
	}
	return counts, nil
}

// matchByID resolves rows by the id namespace the source speaks.
func (s *Service) matchByID(ctx context.Context, source sqlcgen.ImportSource, rows []Row) error {
	byID := map[int]int64{}
	switch source {
	case sqlcgen.ImportSourceAnilist:
		ids := make([]int32, 0, len(rows))
		for _, r := range rows {
			if r.AniListID > 0 {
				ids = append(ids, int32(r.AniListID))
			}
		}
		found, err := s.q.MatchAnimeByAniListIDs(ctx, ids)
		if err != nil {
			return fmt.Errorf("match anilist ids: %w", err)
		}
		for _, f := range found {
			byID[int(f.AnilistID)] = f.ID
		}
		for i := range rows {
			if id, ok := byID[rows[i].AniListID]; ok && rows[i].AniListID > 0 {
				rows[i].AnimeID = id
				rows[i].Match = MatchID
			}
		}
	case sqlcgen.ImportSourceMal:
		ids := make([]int32, 0, len(rows))
		for _, r := range rows {
			if r.MALID > 0 {
				ids = append(ids, int32(r.MALID))
			}
		}
		found, err := s.q.MatchAnimeByMALIDs(ctx, ids)
		if err != nil {
			return fmt.Errorf("match mal ids: %w", err)
		}
		for _, f := range found {
			if f.MalID != nil {
				byID[int(*f.MalID)] = f.ID
			}
		}
		for i := range rows {
			if id, ok := byID[rows[i].MALID]; ok && rows[i].MALID > 0 {
				rows[i].AnimeID = id
				rows[i].Match = MatchID
			}
		}
	}
	return nil
}

type candidate struct {
	anime sqlcgen.Anime
	sim   float64
}

func (s *Service) titleCandidates(ctx context.Context, title string) ([]candidate, error) {
	found, err := s.q.MatchAnimeByTitle(ctx, sqlcgen.MatchAnimeByTitleParams{
		Query: title,
		Limit: titleCandidates,
	})
	if err != nil {
		return nil, err
	}
	cands := make([]candidate, len(found))
	for i, f := range found {
		cands[i] = candidate{anime: f.Anime, sim: f.Similarity}
	}
	return cands, nil
}

// pickMatch is the auto-accept gate. Candidates arrive similarity-sorted.
//
// A candidate actively disagreeing with a source-declared format or year is
// out entirely. The survivor must clear simAutoAccept alone, or simAssisted
// when format or year actively agrees (unknown attributes neither help nor
// hurt — MAL exports carry no year, and demanding one would send every
// id-less MAL row to review). Finally the margin rule: when the runner-up
// is breathing down the winner's neck, no auto-pick — that's exactly the
// two-near-identical-titles case the review bucket exists for.
func pickMatch(row Row, cands []candidate) (sqlcgen.Anime, bool) {
	viable := cands[:0:0]
	for _, c := range cands {
		if formatsDisagree(row, c.anime) || yearsDisagree(row, c.anime) {
			continue
		}
		viable = append(viable, c)
	}
	if len(viable) == 0 {
		return sqlcgen.Anime{}, false
	}
	top := viable[0]
	threshold := simAutoAccept
	if formatsAgree(row, top.anime) || yearsAgree(row, top.anime) {
		threshold = simAssisted
	}
	if top.sim < threshold {
		return sqlcgen.Anime{}, false
	}
	if len(viable) > 1 && top.sim-viable[1].sim < simMargin {
		return sqlcgen.Anime{}, false
	}
	return top.anime, true
}

func formatsAgree(row Row, a sqlcgen.Anime) bool {
	rg, ag := formatGroups(row, a)
	return rg != "" && ag != "" && rg == ag
}

func formatsDisagree(row Row, a sqlcgen.Anime) bool {
	rg, ag := formatGroups(row, a)
	return rg != "" && ag != "" && rg != ag
}

func formatGroups(row Row, a sqlcgen.Anime) (string, string) {
	rg := formatGroup(row.Format)
	ag := ""
	if a.Format != nil {
		ag = formatGroup(string(*a.Format))
	}
	return rg, ag
}

// yearsAgree within ±1: premiere year vs season year skews across sources
// at season boundaries.
func yearsAgree(row Row, a sqlcgen.Anime) bool {
	if row.Year == 0 || a.SeasonYear == nil {
		return false
	}
	diff := row.Year - int(*a.SeasonYear)
	return diff >= -1 && diff <= 1
}

func yearsDisagree(row Row, a sqlcgen.Anime) bool {
	if row.Year == 0 || a.SeasonYear == nil {
		return false
	}
	return !yearsAgree(row, a)
}

// formatGroup folds both sources' format vocabularies into comparable
// buckets. OVA/ONA/Special collapse together on purpose: the two databases
// disagree about those labels constantly, and a false disagreement would
// block a correct match. Unknown or novel labels group as "" (no signal).
func formatGroup(s string) string {
	switch strings.ToUpper(strings.NewReplacer(" ", "", "_", "", "-", "").Replace(strings.TrimSpace(s))) {
	case "TV", "TVSHORT":
		return "tv"
	case "MOVIE":
		return "movie"
	case "SPECIAL", "TVSPECIAL", "OVA", "ONA", "PV", "CM":
		return "special"
	case "MUSIC":
		return "music"
	default:
		return ""
	}
}
