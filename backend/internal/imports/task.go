package imports

// The asynq seam. The task type and payload live here so the producer (API)
// and consumer (worker, via internal/jobs) can't drift apart.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"
)

// TaskProcess runs the fetch/parse/match stage of one import job.
const TaskProcess = "import:process"

// User-facing but not urgent the way notifications are; and bounded — an
// AniList fetch is a single rate-limited request, matching is local SQL.
const (
	taskQueue    = "default"
	taskMaxRetry = 5
	taskTimeout  = 15 * time.Minute
)

type processPayload struct {
	JobID int64 `json:"job_id"`
}

// NewProcessTask builds the task for one job.
func NewProcessTask(jobID int64) *asynq.Task {
	raw, err := json.Marshal(processPayload{JobID: jobID})
	if err != nil { // a struct of one int64 cannot fail to marshal
		raw = []byte("{}")
	}
	return asynq.NewTask(TaskProcess, raw,
		asynq.Queue(taskQueue), asynq.MaxRetry(taskMaxRetry), asynq.Timeout(taskTimeout))
}

// ParseProcessTask extracts the job id from a task payload.
func ParseProcessTask(t *asynq.Task) (int64, error) {
	var p processPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return 0, fmt.Errorf("imports: decode task payload: %w", err)
	}
	if p.JobID <= 0 {
		return 0, fmt.Errorf("imports: task has no job id")
	}
	return p.JobID, nil
}

// Enqueuer is the API-side producer (mirrors notify.Enqueuer). Unlike
// notifications, enqueueing an import is not best-effort: the caller needs
// the error to avoid stranding a pending job.
type Enqueuer struct {
	client *asynq.Client
	log    *slog.Logger
}

func NewEnqueuer(redisAddr string, log *slog.Logger) *Enqueuer {
	return &Enqueuer{
		client: asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr}),
		log:    log,
	}
}

func (e *Enqueuer) Close() error { return e.client.Close() }

// ProcessJob queues the processing stage; satisfies EnqueueFunc.
func (e *Enqueuer) ProcessJob(ctx context.Context, jobID int64) error {
	if _, err := e.client.EnqueueContext(ctx, NewProcessTask(jobID)); err != nil {
		return fmt.Errorf("enqueue %s: %w", TaskProcess, err)
	}
	return nil
}
