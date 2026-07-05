// Package reviews implements long-form reviews with scores, spoiler tagging,
// helpful votes, and soft deletion.
package reviews

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/store/sqlcgen"
)

var (
	ErrNotFound      = errors.New("reviews: not found")
	ErrAnimeNotFound = errors.New("reviews: anime not found")
	ErrForbidden     = errors.New("reviews: not allowed")
)

const (
	minBodyLen = 100
	maxBodyLen = 20000
)

type Service struct {
	q    *sqlcgen.Queries
	pool *pgxpool.Pool
	log  *slog.Logger
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), pool: pool, log: log}
}

type UpsertInput struct {
	Body        string
	Score       int16
	HasSpoilers bool
}

func (in *UpsertInput) Validate() map[string]string {
	problems := map[string]string{}
	in.Body = strings.TrimSpace(in.Body)
	if n := utf8.RuneCountInString(in.Body); n < minBodyLen || n > maxBodyLen {
		problems["body"] = fmt.Sprintf("must be %d-%d characters (got %d)", minBodyLen, maxBodyLen, n)
	}
	if in.Score < 1 || in.Score > 10 {
		problems["score"] = "must be between 1 and 10"
	}
	return problems
}

// Upsert creates or replaces the caller's review of an anime. Only the first
// version emits a 'review' activity — edits shouldn't re-fuel trending.
func (s *Service) Upsert(ctx context.Context, userID, animeID int64, in UpsertInput) (sqlcgen.Review, error) {
	if _, err := s.q.GetAnime(ctx, animeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Review{}, ErrAnimeNotFound
		}
		return sqlcgen.Review{}, fmt.Errorf("get anime: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.Review{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	review, err := qtx.UpdateReview(ctx, sqlcgen.UpdateReviewParams{
		UserID: userID, AnimeID: animeID,
		Body: in.Body, Score: in.Score, HasSpoilers: in.HasSpoilers,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Review{}, fmt.Errorf("update review: %w", err)
		}
		review, err = qtx.CreateReview(ctx, sqlcgen.CreateReviewParams{
			UserID: userID, AnimeID: animeID,
			Body: in.Body, Score: in.Score, HasSpoilers: in.HasSpoilers,
		})
		if err != nil {
			return sqlcgen.Review{}, fmt.Errorf("create review: %w", err)
		}
		payload, _ := json.Marshal(map[string]any{"score": in.Score})
		if err := qtx.InsertActivity(ctx, sqlcgen.InsertActivityParams{
			UserID: userID, Type: sqlcgen.ActivityTypeReview,
			AnimeID: &animeID, RefID: &review.ID, Payload: payload,
		}); err != nil {
			return sqlcgen.Review{}, fmt.Errorf("insert activity: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.Review{}, fmt.Errorf("commit: %w", err)
	}
	return review, nil
}

// Delete soft-deletes. Authors may delete their own; mods may delete any.
func (s *Service) Delete(ctx context.Context, reviewID, callerID int64, callerIsMod bool) error {
	review, err := s.q.GetReviewRow(ctx, reviewID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get review: %w", err)
	}
	if review.UserID != callerID && !callerIsMod {
		return ErrForbidden
	}
	if _, err := s.q.SoftDeleteReview(ctx, reviewID); err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	return nil
}

func (s *Service) ByID(ctx context.Context, id int64) (sqlcgen.GetReviewRow, error) {
	row, err := s.q.GetReview(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.GetReviewRow{}, ErrNotFound
		}
		return sqlcgen.GetReviewRow{}, fmt.Errorf("get review: %w", err)
	}
	return row, nil
}

func (s *Service) Mine(ctx context.Context, userID, animeID int64) (sqlcgen.Review, error) {
	review, err := s.q.GetUserReviewForAnime(ctx, sqlcgen.GetUserReviewForAnimeParams{
		UserID: userID, AnimeID: animeID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.Review{}, ErrNotFound
		}
		return sqlcgen.Review{}, fmt.Errorf("get my review: %w", err)
	}
	return review, nil
}

func (s *Service) ForAnime(ctx context.Context, animeID int64, page, per int) ([]sqlcgen.ListReviewsForAnimeRow, bool, error) {
	rows, err := s.q.ListReviewsForAnime(ctx, sqlcgen.ListReviewsForAnimeParams{
		AnimeID: animeID,
		Limit:   int32(per) + 1,
		Offset:  int32((page - 1) * per),
	})
	if err != nil {
		return nil, false, fmt.Errorf("list reviews: %w", err)
	}
	hasMore := len(rows) > per
	if hasMore {
		rows = rows[:per]
	}
	return rows, hasMore, nil
}

func (s *Service) ByUser(ctx context.Context, userID int64, page, per int) ([]sqlcgen.ListReviewsByUserRow, bool, error) {
	rows, err := s.q.ListReviewsByUser(ctx, sqlcgen.ListReviewsByUserParams{
		UserID: userID,
		Limit:  int32(per) + 1,
		Offset: int32((page - 1) * per),
	})
	if err != nil {
		return nil, false, fmt.Errorf("list user reviews: %w", err)
	}
	hasMore := len(rows) > per
	if hasMore {
		rows = rows[:per]
	}
	return rows, hasMore, nil
}

// SetHelpful votes/unvotes and returns the new count. Voting for your own
// review is rejected. Idempotent in both directions.
func (s *Service) SetHelpful(ctx context.Context, reviewID, userID int64, helpful bool) (int32, error) {
	review, err := s.q.GetReviewRow(ctx, reviewID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("get review: %w", err)
	}
	if review.UserID == userID {
		return 0, ErrForbidden
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	var changed int64
	if helpful {
		changed, err = qtx.AddReviewVote(ctx, sqlcgen.AddReviewVoteParams{ReviewID: reviewID, UserID: userID})
	} else {
		changed, err = qtx.RemoveReviewVote(ctx, sqlcgen.RemoveReviewVoteParams{ReviewID: reviewID, UserID: userID})
	}
	if err != nil {
		return 0, fmt.Errorf("vote: %w", err)
	}

	count := review.HelpfulCount
	if changed > 0 {
		delta := int32(1)
		if !helpful {
			delta = -1
		}
		count, err = qtx.AdjustHelpfulCount(ctx, sqlcgen.AdjustHelpfulCountParams{ID: reviewID, HelpfulCount: delta})
		if err != nil {
			return 0, fmt.Errorf("adjust count: %w", err)
		}
		if helpful {
			if err := qtx.InsertActivity(ctx, sqlcgen.InsertActivityParams{
				UserID: userID, Type: sqlcgen.ActivityTypeHelpfulVote,
				AnimeID: &review.AnimeID, RefID: &reviewID, Payload: []byte("{}"),
			}); err != nil {
				return 0, fmt.Errorf("insert activity: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	return count, nil
}

// VotedSet returns which of the given reviews the user has marked helpful.
func (s *Service) VotedSet(ctx context.Context, userID int64, reviewIDs []int64) (map[int64]bool, error) {
	if len(reviewIDs) == 0 {
		return map[int64]bool{}, nil
	}
	ids, err := s.q.UserVotesForReviews(ctx, sqlcgen.UserVotesForReviewsParams{
		UserID: userID, Column2: reviewIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("voted set: %w", err)
	}
	set := make(map[int64]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set, nil
}
