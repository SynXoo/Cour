package imports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"cour/internal/anilist"
	"cour/internal/store/sqlcgen"
)

// ListFetcher is the slice of the AniList client the processor needs;
// narrow so tests can fake a user list without a GraphQL server.
type ListFetcher interface {
	UserList(ctx context.Context, username string) (anilist.UserList, error)
}

// EnqueueFunc hands a created job to the worker queue. The API process
// wires this to an asynq producer; the worker (which only processes) and
// unit tests leave it nil or fake it.
type EnqueueFunc func(ctx context.Context, jobID int64) error

type Service struct {
	q        *sqlcgen.Queries
	pool     *pgxpool.Pool
	fetcher  ListFetcher // nil in the API process — only Process uses it
	enqueue  EnqueueFunc // nil in the worker process — only Create* use it
	demoMode bool
	log      *slog.Logger
}

func New(pool *pgxpool.Pool, fetcher ListFetcher, enqueue EnqueueFunc, demoMode bool, log *slog.Logger) *Service {
	return &Service{
		q: sqlcgen.New(pool), pool: pool,
		fetcher: fetcher, enqueue: enqueue, demoMode: demoMode, log: log,
	}
}

// ── Job creation (API process) ─────────────────────────────────────────────

// CreateAniList opens an import job for a public AniList list and queues
// its processing. Any uncommitted preview the user left behind is
// superseded; a job actively running fails with ErrActiveImport.
func (s *Service) CreateAniList(ctx context.Context, userID int64, username string) (sqlcgen.ImportJob, error) {
	username = strings.TrimSpace(username)
	if username == "" || strings.ContainsAny(username, " \t\n") {
		return sqlcgen.ImportJob{}, &BadInputError{Reason: "invalid AniList username"}
	}
	payload := encode(map[string]string{"username": username})
	return s.createJob(ctx, userID, sqlcgen.ImportSourceAnilist, payload, nil, Counts{})
}

// CreateMAL parses an uploaded MAL export (fail fast — a malformed file
// should bounce at upload, not minutes later) and queues matching.
func (s *Service) CreateMAL(ctx context.Context, userID int64, filename string, file io.Reader) (sqlcgen.ImportJob, error) {
	rows, err := ParseMAL(file)
	if err != nil {
		return sqlcgen.ImportJob{}, err
	}
	if len(rows) > maxRows {
		return sqlcgen.ImportJob{}, &BadInputError{Reason: fmt.Sprintf("export has %d entries; the import cap is %d", len(rows), maxRows)}
	}
	payload := encode(map[string]string{"filename": filename})
	return s.createJob(ctx, userID, sqlcgen.ImportSourceMal, payload, encode(rows), Counts{Total: len(rows)})
}

func (s *Service) createJob(ctx context.Context, userID int64, source sqlcgen.ImportSource, payload, rows []byte, counts Counts) (sqlcgen.ImportJob, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sqlcgen.ImportJob{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	// One transaction, so a rejected create doesn't strand the supersede.
	if err := qtx.SupersedeReadyImports(ctx, userID); err != nil {
		return sqlcgen.ImportJob{}, fmt.Errorf("supersede: %w", err)
	}
	job, err := qtx.CreateImportJob(ctx, sqlcgen.CreateImportJobParams{
		UserID: userID, Source: source, Payload: payload, Rows: rows, Counts: encode(counts),
	})
	if err != nil {
		if isUniqueViolation(err) {
			return sqlcgen.ImportJob{}, ErrActiveImport
		}
		return sqlcgen.ImportJob{}, fmt.Errorf("create job: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return sqlcgen.ImportJob{}, fmt.Errorf("commit: %w", err)
	}

	// A job that never reaches the queue would sit 'pending' forever and
	// (via the one-active index) block every future import — fail it loudly.
	if err := s.enqueue(ctx, job.ID); err != nil {
		s.log.Error("import enqueue failed", "job", job.ID, "err", err)
		if failErr := s.q.FailImportJob(ctx, sqlcgen.FailImportJobParams{ID: job.ID, Error: ptr("could not queue the import; try again")}); failErr != nil {
			s.log.Error("failing unqueued job also failed", "job", job.ID, "err", failErr)
		}
		return sqlcgen.ImportJob{}, fmt.Errorf("enqueue import job: %w", err)
	}
	return job, nil
}

// Get returns one of the user's jobs.
func (s *Service) Get(ctx context.Context, userID, jobID int64) (sqlcgen.ImportJob, error) {
	job, err := s.q.GetImportJobForUser(ctx, sqlcgen.GetImportJobForUserParams{ID: jobID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlcgen.ImportJob{}, ErrNotFound
		}
		return sqlcgen.ImportJob{}, fmt.Errorf("get job: %w", err)
	}
	return job, nil
}

// ── Processing (worker process) ────────────────────────────────────────────

// Process runs the fetch/parse/match stage. Returning an error means
// "retry me" (asynq re-delivers); permanent failures mark the job failed
// and return nil so the queue lets go.
func (s *Service) Process(ctx context.Context, jobID int64) error {
	job, err := s.q.GetImportJob(ctx, jobID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.log.Warn("import task for missing job", "job", jobID)
			return nil
		}
		return fmt.Errorf("get job: %w", err)
	}
	claimed, err := s.q.MarkImportJobProcessing(ctx, jobID)
	if err != nil {
		return fmt.Errorf("claim job: %w", err)
	}
	if claimed == 0 {
		// Superseded, failed, or already committed — the task is stale.
		s.log.Info("import task dropped, job moved on", "job", jobID, "status", job.Status)
		return nil
	}

	var rows []Row
	switch job.Source {
	case sqlcgen.ImportSourceAnilist:
		rows, err = s.fetchAniListRows(ctx, job)
		if err != nil {
			var gqlErr *anilist.GraphQLError
			if errors.As(err, &gqlErr) {
				// AniList said no (unknown user, private list) — retrying
				// won't change its mind.
				return s.failJob(ctx, jobID, "AniList rejected the request: "+gqlErr.Message)
			}
			return fmt.Errorf("fetch anilist list: %w", err)
		}
	case sqlcgen.ImportSourceMal:
		rows, err = DecodeRows(job.Rows)
		if err != nil {
			return s.failJob(ctx, jobID, "stored rows are unreadable")
		}
	}

	switch {
	case len(rows) == 0:
		return s.failJob(ctx, jobID, "the list has no importable entries")
	case len(rows) > maxRows:
		return s.failJob(ctx, jobID, fmt.Sprintf("the list has %d entries; the import cap is %d", len(rows), maxRows))
	}

	counts, err := s.matchRows(ctx, job.UserID, job.Source, rows)
	if err != nil {
		return fmt.Errorf("match rows: %w", err)
	}
	if err := s.q.FinishImportJobProcessing(ctx, sqlcgen.FinishImportJobProcessingParams{
		ID: jobID, Rows: encode(rows), Counts: encode(counts),
	}); err != nil {
		return fmt.Errorf("finish job: %w", err)
	}
	s.log.Info("import processed", "job", jobID, "source", job.Source,
		"total", counts.Total, "matched", counts.Matched, "review", counts.Review)
	return nil
}

func (s *Service) fetchAniListRows(ctx context.Context, job sqlcgen.ImportJob) ([]Row, error) {
	if s.demoMode || s.fetcher == nil {
		// The API refuses to create AniList jobs in demo mode; this is the
		// backstop for tasks created before a mode flip.
		return nil, &anilist.GraphQLError{Message: "AniList import is unavailable in demo mode"}
	}
	var payload struct {
		Username string `json:"username"`
	}
	if err := unmarshalPayload(job.Payload, &payload); err != nil || payload.Username == "" {
		return nil, &anilist.GraphQLError{Message: "job has no username"}
	}
	list, err := s.fetcher.UserList(ctx, payload.Username)
	if err != nil {
		return nil, err
	}
	return RowsFromAniList(list), nil
}

// Fail marks a job failed from outside the processor — the worker calls it
// when retries are exhausted, so a dead task can't strand a 'processing'
// job that blocks the user's next import forever.
func (s *Service) Fail(ctx context.Context, jobID int64, reason string) error {
	return s.q.FailImportJob(ctx, sqlcgen.FailImportJobParams{ID: jobID, Error: &reason})
}

func (s *Service) failJob(ctx context.Context, jobID int64, reason string) error {
	if err := s.q.FailImportJob(ctx, sqlcgen.FailImportJobParams{ID: jobID, Error: &reason}); err != nil {
		return fmt.Errorf("fail job: %w", err)
	}
	s.log.Info("import failed", "job", jobID, "reason", reason)
	return nil
}

// ── Commit (API process) ───────────────────────────────────────────────────

// Commit applies a ready job. Synchronous: the whole apply is one
// transaction (well under a second at the row cap), so the caller gets the
// final job back. A failed apply rolls back and reopens the job as ready,
// with the error recorded, so commit can be retried.
func (s *Service) Commit(ctx context.Context, userID, jobID int64, mode Mode, resolutions map[int]*int64) (sqlcgen.ImportJob, error) {
	if mode != ModeMerge && mode != ModeOverwrite {
		return sqlcgen.ImportJob{}, &BadInputError{Reason: "mode must be merge or overwrite"}
	}
	job, err := s.Get(ctx, userID, jobID)
	if err != nil {
		return sqlcgen.ImportJob{}, err
	}
	if job.Status != sqlcgen.ImportStatusReady {
		return sqlcgen.ImportJob{}, ErrNotReady
	}
	rows, err := DecodeRows(job.Rows)
	if err != nil {
		return sqlcgen.ImportJob{}, fmt.Errorf("decode rows: %w", err)
	}
	if err := s.validateResolutions(ctx, rows, resolutions); err != nil {
		return sqlcgen.ImportJob{}, err
	}

	claimed, err := s.q.MarkImportJobCommitting(ctx, jobID)
	if err != nil {
		return sqlcgen.ImportJob{}, fmt.Errorf("claim commit: %w", err)
	}
	if claimed == 0 { // lost a race with another commit or a supersede
		return sqlcgen.ImportJob{}, ErrNotReady
	}

	applied, skipped, err := s.apply(ctx, userID, rows, mode, resolutions)
	if err != nil {
		reason := "apply failed; nothing was written"
		if reopenErr := s.q.ReopenImportJob(ctx, sqlcgen.ReopenImportJobParams{ID: jobID, Error: &reason}); reopenErr != nil {
			s.log.Error("reopening job after failed apply also failed", "job", jobID, "err", reopenErr)
		}
		return sqlcgen.ImportJob{}, fmt.Errorf("apply: %w", err)
	}

	counts := DecodeCounts(job.Counts)
	counts.Applied = applied
	counts.Skipped = skipped
	if err := s.q.CompleteImportJob(ctx, sqlcgen.CompleteImportJobParams{ID: jobID, Counts: encode(counts)}); err != nil {
		return sqlcgen.ImportJob{}, fmt.Errorf("complete job: %w", err)
	}
	s.log.Info("import committed", "job", jobID, "mode", mode, "applied", applied, "skipped", skipped)
	return s.Get(ctx, userID, jobID)
}

// validateResolutions rejects out-of-range indexes and unknown anime before
// the job is claimed, so bad input never consumes the one commit.
func (s *Service) validateResolutions(ctx context.Context, rows []Row, resolutions map[int]*int64) error {
	ids := make([]int64, 0, len(resolutions))
	for idx, target := range resolutions {
		if idx < 0 || idx >= len(rows) {
			return &BadInputError{Reason: fmt.Sprintf("resolution row_index %d is out of range", idx)}
		}
		if target != nil {
			ids = append(ids, *target)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	anime, err := s.q.ListAnimeByIDs(ctx, ids)
	if err != nil {
		return fmt.Errorf("validate resolutions: %w", err)
	}
	known := make(map[int64]bool, len(anime))
	for _, a := range anime {
		known[a.ID] = true
	}
	for _, target := range resolutions {
		if target != nil && !known[*target] {
			return &BadInputError{Reason: fmt.Sprintf("resolution anime_id %d does not exist", *target)}
		}
	}
	return nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func unmarshalPayload(raw []byte, dest any) error {
	if len(raw) == 0 {
		return errors.New("empty payload")
	}
	return json.Unmarshal(raw, dest)
}

func ptr[T any](v T) *T { return &v }
