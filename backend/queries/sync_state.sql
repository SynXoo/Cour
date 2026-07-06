-- name: GetSyncState :one
SELECT value FROM sync_state WHERE key = $1;

-- name: SetSyncState :exec
INSERT INTO sync_state (key, value)
VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
