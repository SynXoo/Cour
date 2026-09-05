-- Watch parties (docs/WATCH_PARTIES.md). Rows are the durable shell; the live
-- room (members, clock) is Redis state owned by internal/realtime.

-- name: CreateParty :one
INSERT INTO watch_parties (episode_id, host_id, visibility)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CloseOpenPartiesForHost :execrows
UPDATE watch_parties SET closed_at = now()
WHERE host_id = $1 AND closed_at IS NULL;

-- name: GetPartyView :one
SELECT sqlc.embed(watch_parties), sqlc.embed(episodes), sqlc.embed(anime),
       users.username AS host_username, users.avatar_url AS host_avatar_url
FROM watch_parties
JOIN episodes ON episodes.id = watch_parties.episode_id
JOIN anime    ON anime.id = episodes.anime_id
JOIN users    ON users.id = watch_parties.host_id
WHERE watch_parties.id = $1;

-- name: GetEpisode :one
SELECT * FROM episodes WHERE id = $1;

-- name: ListUsersByIDs :many
-- Member hydration for a room's presence set; order is the caller's job.
SELECT id, username, avatar_url FROM users WHERE id = ANY($1::bigint[]);
