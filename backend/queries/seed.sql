-- Seed-only helpers (cmd/seed): never called by the API or worker.

-- name: SpreadActivityTimestamps :exec
-- Demo data lands all at once; smear it across the trending window so decay
-- has something to bite on.
UPDATE activities SET created_at = now() - (random() * interval '13 days');

-- name: SpreadListEntryTimestamps :exec
UPDATE list_entries SET updated_at = now() - (random() * interval '13 days');

-- name: CountUsers :one
SELECT COUNT(*)::bigint FROM users;
