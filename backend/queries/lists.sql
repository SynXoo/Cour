-- name: GetListEntry :one
SELECT * FROM list_entries WHERE user_id = $1 AND anime_id = $2;

-- name: CreateListEntry :one
INSERT INTO list_entries (user_id, anime_id, status, score, progress, started_on, finished_on)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateListEntry :one
UPDATE list_entries SET
  status = $3,
  score = $4,
  progress = $5,
  started_on = $6,
  finished_on = $7
WHERE user_id = $1 AND anime_id = $2
RETURNING *;

-- name: DeleteListEntry :execrows
DELETE FROM list_entries WHERE user_id = $1 AND anime_id = $2;

-- name: ListEntriesForUser :many
SELECT sqlc.embed(list_entries), sqlc.embed(anime)
FROM list_entries
JOIN anime ON anime.id = list_entries.anime_id
WHERE list_entries.user_id = $1
  AND (sqlc.narg('status')::list_status IS NULL OR list_entries.status = sqlc.narg('status'))
ORDER BY list_entries.updated_at DESC
LIMIT $2;

-- name: AddFavorite :execrows
INSERT INTO favorites (user_id, anime_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveFavorite :execrows
DELETE FROM favorites WHERE user_id = $1 AND anime_id = $2;

-- name: IsFavorite :one
SELECT EXISTS(SELECT 1 FROM favorites WHERE user_id = $1 AND anime_id = $2);

-- name: ListFavorites :many
SELECT sqlc.embed(anime), favorites.created_at AS favorited_at
FROM favorites
JOIN anime ON anime.id = favorites.anime_id
WHERE favorites.user_id = $1
ORDER BY favorites.created_at DESC
LIMIT $2;

-- name: InsertActivity :exec
INSERT INTO activities (user_id, type, anime_id, ref_id, payload)
VALUES ($1, $2, $3, $4, $5);
