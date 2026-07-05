// Package lists implements the tracking core: list entries with status,
// score, and progress; favorites; and the activity records those mutations
// emit (which later power feeds and trending).
package lists

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/store/sqlcgen"
)

var (
	ErrNotFound      = errors.New("lists: entry not found")
	ErrAnimeNotFound = errors.New("lists: anime not found")
)

type Service struct {
	q    *sqlcgen.Queries
	pool *pgxpool.Pool
	log  *slog.Logger
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), pool: pool, log: log}
}

// UpsertInput is the caller's desired end state for an entry. Nil pointers
// mean "not provided" and preserve the existing value on updates.
type UpsertInput struct {
	Status     sqlcgen.ListStatus
	Score      *int16     // 1-10
	Progress   *int32     // episodes watched
	StartedOn  *time.Time // date-only
	FinishedOn *time.Time
}

// Upsert creates or updates the (user, anime) entry, applies the
// quality-of-life transitions, and records matching activities atomically:
//
//   - progress reaching the episode count flips watching -> completed
//   - completing fills progress and finished_on
//   - first move into watching stamps started_on
func (s *Service) Upsert(ctx context.Context, userID, animeID int64, in UpsertInput) (sqlcgen.ListEntry, error) {
	anime, err := s.q.GetAnime(ctx, animeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.ListEntry{}, ErrAnimeNotFound
		}
		return sqlcgen.ListEntry{}, fmt.Errorf("get anime: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.ListEntry{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	prior, err := qtx.GetListEntry(ctx, sqlcgen.GetListEntryParams{UserID: userID, AnimeID: animeID})
	isNew := false
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.ListEntry{}, fmt.Errorf("get entry: %w", err)
		}
		isNew = true
	}

	next := resolveEntry(prior, isNew, in, anime.EpisodesCount)

	var entry sqlcgen.ListEntry
	if isNew {
		entry, err = qtx.CreateListEntry(ctx, sqlcgen.CreateListEntryParams{
			UserID: userID, AnimeID: animeID,
			Status: next.Status, Score: next.Score, Progress: next.Progress,
			StartedOn: next.StartedOn, FinishedOn: next.FinishedOn,
		})
	} else {
		entry, err = qtx.UpdateListEntry(ctx, sqlcgen.UpdateListEntryParams{
			UserID: userID, AnimeID: animeID,
			Status: next.Status, Score: next.Score, Progress: next.Progress,
			StartedOn: next.StartedOn, FinishedOn: next.FinishedOn,
		})
	}
	if err != nil {
		return sqlcgen.ListEntry{}, fmt.Errorf("write entry: %w", err)
	}

	for _, act := range diffActivities(userID, animeID, prior, entry, isNew) {
		if err := qtx.InsertActivity(ctx, act); err != nil {
			return sqlcgen.ListEntry{}, fmt.Errorf("insert activity: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.ListEntry{}, fmt.Errorf("commit: %w", err)
	}
	return entry, nil
}

// resolved is the computed end state before writing.
type resolved struct {
	Status     sqlcgen.ListStatus
	Score      *int16
	Progress   int32
	StartedOn  *time.Time
	FinishedOn *time.Time
}

func resolveEntry(prior sqlcgen.ListEntry, isNew bool, in UpsertInput, episodeCount *int32) resolved {
	r := resolved{Status: in.Status}

	// Start from prior values; explicit inputs override.
	if !isNew {
		r.Score = prior.Score
		r.Progress = prior.Progress
		r.StartedOn = prior.StartedOn
		r.FinishedOn = prior.FinishedOn
	}
	if in.Score != nil {
		if *in.Score == 0 {
			r.Score = nil // explicit clear
		} else {
			r.Score = in.Score
		}
	}
	if in.Progress != nil {
		r.Progress = *in.Progress
	}
	if in.StartedOn != nil {
		r.StartedOn = in.StartedOn
	}
	if in.FinishedOn != nil {
		r.FinishedOn = in.FinishedOn
	}

	// Clamp progress to the known episode count.
	if episodeCount != nil && *episodeCount > 0 && r.Progress > *episodeCount {
		r.Progress = *episodeCount
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)

	// Watching every episode = completed, no extra click needed.
	if episodeCount != nil && *episodeCount > 0 && r.Progress == *episodeCount &&
		r.Status == sqlcgen.ListStatusWatching {
		r.Status = sqlcgen.ListStatusCompleted
	}
	if r.Status == sqlcgen.ListStatusCompleted {
		if episodeCount != nil && *episodeCount > 0 {
			r.Progress = *episodeCount
		}
		if r.FinishedOn == nil {
			r.FinishedOn = &today
		}
	}
	if r.Status == sqlcgen.ListStatusWatching && r.StartedOn == nil {
		r.StartedOn = &today
	}
	return r
}

// diffActivities compares prior/next and emits the activity records the
// change deserves.
func diffActivities(userID, animeID int64, prior sqlcgen.ListEntry, next sqlcgen.ListEntry, isNew bool) []sqlcgen.InsertActivityParams {
	var acts []sqlcgen.InsertActivityParams
	add := func(t sqlcgen.ActivityType, payload map[string]any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			raw = []byte("{}")
		}
		acts = append(acts, sqlcgen.InsertActivityParams{
			UserID: userID, Type: t, AnimeID: &animeID, Payload: raw,
		})
	}

	switch {
	case isNew:
		add(sqlcgen.ActivityTypeListAdd, map[string]any{"status": next.Status})
		if next.Status == sqlcgen.ListStatusCompleted {
			add(sqlcgen.ActivityTypeCompleted, map[string]any{})
		}
	case prior.Status != next.Status:
		if next.Status == sqlcgen.ListStatusCompleted {
			add(sqlcgen.ActivityTypeCompleted, map[string]any{})
		} else {
			add(sqlcgen.ActivityTypeStatusChange, map[string]any{
				"from": prior.Status, "to": next.Status,
			})
		}
	case next.Progress > prior.Progress:
		add(sqlcgen.ActivityTypeProgress, map[string]any{"progress": next.Progress})
	}

	// Scoring is worth an activity whether or not the status moved.
	if next.Score != nil && (isNew || prior.Score == nil || *prior.Score != *next.Score) {
		add(sqlcgen.ActivityTypeScored, map[string]any{"score": *next.Score})
	}
	return acts
}

func (s *Service) Remove(ctx context.Context, userID, animeID int64) error {
	n, err := s.q.DeleteListEntry(ctx, sqlcgen.DeleteListEntryParams{UserID: userID, AnimeID: animeID})
	if err != nil {
		return fmt.Errorf("delete entry: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) Entry(ctx context.Context, userID, animeID int64) (sqlcgen.ListEntry, error) {
	entry, err := s.q.GetListEntry(ctx, sqlcgen.GetListEntryParams{UserID: userID, AnimeID: animeID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.ListEntry{}, ErrNotFound
		}
		return sqlcgen.ListEntry{}, fmt.Errorf("get entry: %w", err)
	}
	return entry, nil
}

const myListLimit = 1000

func (s *Service) ListFor(ctx context.Context, userID int64, status *sqlcgen.ListStatus) ([]sqlcgen.ListEntriesForUserRow, error) {
	rows, err := s.q.ListEntriesForUser(ctx, sqlcgen.ListEntriesForUserParams{
		UserID: userID,
		Status: status,
		Limit:  myListLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("list entries: %w", err)
	}
	return rows, nil
}

// Favorite adds to favorites and records the activity (once).
func (s *Service) Favorite(ctx context.Context, userID, animeID int64) error {
	if _, err := s.q.GetAnime(ctx, animeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAnimeNotFound
		}
		return fmt.Errorf("get anime: %w", err)
	}
	n, err := s.q.AddFavorite(ctx, sqlcgen.AddFavoriteParams{UserID: userID, AnimeID: animeID})
	if err != nil {
		return fmt.Errorf("add favorite: %w", err)
	}
	if n > 0 { // newly added, not a repeat
		if err := s.q.InsertActivity(ctx, sqlcgen.InsertActivityParams{
			UserID: userID, Type: sqlcgen.ActivityTypeFavorite, AnimeID: &animeID, Payload: []byte("{}"),
		}); err != nil {
			return fmt.Errorf("insert activity: %w", err)
		}
	}
	return nil
}

func (s *Service) Unfavorite(ctx context.Context, userID, animeID int64) error {
	if _, err := s.q.RemoveFavorite(ctx, sqlcgen.RemoveFavoriteParams{UserID: userID, AnimeID: animeID}); err != nil {
		return fmt.Errorf("remove favorite: %w", err)
	}
	return nil
}

const favoritesLimit = 200

func (s *Service) Favorites(ctx context.Context, userID int64) ([]sqlcgen.ListFavoritesRow, error) {
	rows, err := s.q.ListFavorites(ctx, sqlcgen.ListFavoritesParams{UserID: userID, Limit: favoritesLimit})
	if err != nil {
		return nil, fmt.Errorf("list favorites: %w", err)
	}
	return rows, nil
}

func (s *Service) IsFavorite(ctx context.Context, userID, animeID int64) (bool, error) {
	fav, err := s.q.IsFavorite(ctx, sqlcgen.IsFavoriteParams{UserID: userID, AnimeID: animeID})
	if err != nil {
		return false, fmt.Errorf("is favorite: %w", err)
	}
	return fav, nil
}
