-- name: CreateReport :one
INSERT INTO reports (reporter_id, subject_type, subject_id, reason)
VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING
RETURNING id;

-- name: ListOpenReports :many
SELECT sqlc.embed(reports), users.username AS reporter_username
FROM reports
JOIN users ON users.id = reports.reporter_id
WHERE reports.status = 'open' AND reports.id < $1
ORDER BY reports.id DESC
LIMIT $2;

-- name: ResolveReport :execrows
UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now()
WHERE id = $1 AND status = 'open';
