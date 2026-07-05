// Package moderation implements the safety basics: user reports with mod
// resolution, and the profanity-filter hook applied at content creation.
// Content removal itself rides the existing soft-delete endpoints (which
// already accept mod callers).
package moderation

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/store/sqlcgen"
)

var (
	ErrSubjectNotFound = errors.New("moderation: subject not found")
	ErrBadReason       = errors.New("moderation: reason must be 3-500 characters")
)

type Service struct {
	q   *sqlcgen.Queries
	log *slog.Logger
}

func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{q: sqlcgen.New(pool), log: log}
}

// Report files a report after verifying the subject actually exists.
// Duplicate open reports from the same user are silently deduplicated.
func (s *Service) Report(ctx context.Context, reporterID int64, subjectType sqlcgen.ReportSubject, subjectID int64, reason string) error {
	reason = strings.TrimSpace(reason)
	if len(reason) < 3 || len(reason) > 500 {
		return ErrBadReason
	}

	var err error
	switch subjectType {
	case sqlcgen.ReportSubjectReview:
		_, err = s.q.GetReviewRow(ctx, subjectID)
	case sqlcgen.ReportSubjectComment:
		_, err = s.q.GetComment(ctx, subjectID)
	case sqlcgen.ReportSubjectUser:
		_, err = s.q.GetUser(ctx, subjectID)
	default:
		return ErrSubjectNotFound
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrSubjectNotFound
		}
		return fmt.Errorf("verify subject: %w", err)
	}

	if _, err := s.q.CreateReport(ctx, sqlcgen.CreateReportParams{
		ReporterID:  reporterID,
		SubjectType: subjectType,
		SubjectID:   subjectID,
		Reason:      reason,
	}); err != nil && !errors.Is(err, pgx.ErrNoRows) { // no rows = dedup hit
		return fmt.Errorf("create report: %w", err)
	}
	return nil
}

func (s *Service) OpenReports(ctx context.Context, cursor int64, limit int) ([]sqlcgen.ListOpenReportsRow, int64, error) {
	if cursor <= 0 {
		cursor = math.MaxInt64
	}
	rows, err := s.q.ListOpenReports(ctx, sqlcgen.ListOpenReportsParams{ID: cursor, Limit: int32(limit) + 1})
	if err != nil {
		return nil, 0, fmt.Errorf("list reports: %w", err)
	}
	var next int64
	if len(rows) > limit {
		rows = rows[:limit]
		next = rows[len(rows)-1].Report.ID
	}
	return rows, next, nil
}

// Resolve closes a report as resolved or dismissed. Idempotent: resolving a
// closed report reports not-found.
func (s *Service) Resolve(ctx context.Context, reportID, modID int64, dismiss bool) error {
	status := sqlcgen.ReportStatusResolved
	if dismiss {
		status = sqlcgen.ReportStatusDismissed
	}
	n, err := s.q.ResolveReport(ctx, sqlcgen.ResolveReportParams{
		ID: reportID, Status: status, ResolvedBy: &modID,
	})
	if err != nil {
		return fmt.Errorf("resolve report: %w", err)
	}
	if n == 0 {
		return ErrSubjectNotFound
	}
	return nil
}
