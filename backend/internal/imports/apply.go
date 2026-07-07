package imports

// The bulk apply. THE RULE (docs/PHASE_2.md §M1): this path inserts zero
// activities rows. Activities feed the follow feed and Trending Now; an
// import is history arriving, not history happening. That is why this loop
// exists at all instead of calling lists.Service.Upsert per entry — the
// service method records activities by design, and it would take exactly
// one refactor-happy afternoon to turn a 900-title import into a feed
// flood. The regression test in internal/integration pins this down.

import (
	"context"
	"fmt"

	"cour/internal/store/sqlcgen"
)

// apply writes the import in one transaction and returns applied/skipped
// counts. resolutions maps row index → target anime id, overriding (or,
// with nil, excluding) that row; unresolved review rows are skipped.
func (s *Service) apply(ctx context.Context, userID int64, rows []Row, mode Mode, resolutions map[int]*int64) (applied, skipped int, err error) {
	type target struct {
		row     Row
		animeID int64
	}
	targets := make([]target, 0, len(rows))
	seen := make(map[int64]bool, len(rows))
	for i, row := range rows {
		animeID := row.AnimeID
		if res, ok := resolutions[i]; ok {
			if res == nil { // explicit exclusion
				skipped++
				continue
			}
			animeID = *res
		}
		if animeID == 0 { // unresolved review row
			skipped++
			continue
		}
		if seen[animeID] { // two source rows, one target: first wins
			skipped++
			continue
		}
		seen[animeID] = true
		targets = append(targets, target{row: row, animeID: animeID})
	}

	// One hydration pass: episode counts for normalization, and existence —
	// a target vanished since matching (catalog row deleted) is a skip, not
	// an abort.
	ids := make([]int64, len(targets))
	for i, t := range targets {
		ids[i] = t.animeID
	}
	anime, err := s.q.ListAnimeByIDs(ctx, ids)
	if err != nil {
		return 0, 0, fmt.Errorf("hydrate targets: %w", err)
	}
	episodeCounts := make(map[int64]*int32, len(anime))
	for _, a := range anime {
		episodeCounts[a.ID] = a.EpisodesCount
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	// Merge semantics read the live list inside the transaction — the
	// preview's on_list flags are stale by definition.
	tracked, err := qtx.ListEntryAnimeIDs(ctx, userID)
	if err != nil {
		return 0, 0, fmt.Errorf("list entry ids: %w", err)
	}
	existing := make(map[int64]bool, len(tracked))
	for _, id := range tracked {
		existing[id] = true
	}

	for _, t := range targets {
		count, known := episodeCounts[t.animeID]
		if !known {
			skipped++
			continue
		}
		if mode == ModeMerge && existing[t.animeID] {
			skipped++
			continue
		}
		if err := qtx.ImportUpsertListEntry(ctx, entryParams(userID, t.animeID, t.row, count)); err != nil {
			return 0, 0, fmt.Errorf("upsert anime %d: %w", t.animeID, err)
		}
		applied++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, fmt.Errorf("commit: %w", err)
	}
	return applied, skipped, nil
}

// entryParams normalizes one row against its target. Imported state is
// historical, so no quality-of-life transitions run (a 2015 completion must
// not get today stamped as finished_on) — but progress is squared with the
// known episode count the same way the tracker itself would: completed
// means all episodes, and nothing exceeds the count.
func entryParams(userID, animeID int64, row Row, episodeCount *int32) sqlcgen.ImportUpsertListEntryParams {
	progress := row.Progress
	if progress < 0 {
		progress = 0
	}
	if episodeCount != nil && *episodeCount > 0 {
		if row.Status == sqlcgen.ListStatusCompleted || progress > *episodeCount {
			progress = *episodeCount
		}
	}
	return sqlcgen.ImportUpsertListEntryParams{
		UserID:     userID,
		AnimeID:    animeID,
		Status:     row.Status,
		Score:      row.Score,
		Progress:   progress,
		StartedOn:  ParseEntryDate(row.StartedOn),
		FinishedOn: ParseEntryDate(row.FinishedOn),
	}
}
