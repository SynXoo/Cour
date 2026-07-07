-- name: CreateImportJob :one
INSERT INTO import_jobs (user_id, source, payload, rows, counts)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetImportJob :one
SELECT * FROM import_jobs WHERE id = $1;

-- name: GetImportJobForUser :one
SELECT * FROM import_jobs WHERE id = $1 AND user_id = $2;

-- name: SupersedeReadyImports :exec
-- A new import replaces any preview the user walked away from.
UPDATE import_jobs SET status = 'superseded'
WHERE user_id = $1 AND status = 'ready';

-- name: MarkImportJobProcessing :execrows
-- Idempotent claim: a re-delivered asynq task may re-claim a job stuck in
-- 'processing' (a crashed run); any other status means the job moved on and
-- the task should be dropped.
UPDATE import_jobs SET status = 'processing'
WHERE id = $1 AND status IN ('pending', 'processing');

-- name: FinishImportJobProcessing :exec
UPDATE import_jobs SET status = 'ready', rows = $2, counts = $3
WHERE id = $1;

-- name: FailImportJob :exec
UPDATE import_jobs SET status = 'failed', error = $2 WHERE id = $1;

-- name: MarkImportJobCommitting :execrows
-- Guard: only a ready job can be committed, and only one commit can claim it.
UPDATE import_jobs SET status = 'committing' WHERE id = $1 AND status = 'ready';

-- name: CompleteImportJob :exec
UPDATE import_jobs SET status = 'done', counts = $2 WHERE id = $1;

-- name: ReopenImportJob :exec
-- A failed apply rolled back atomically, so the preview is still valid:
-- return the job to 'ready' with the error recorded and let commit retry.
UPDATE import_jobs SET status = 'ready', error = $2 WHERE id = $1;
