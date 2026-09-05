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

-- name: CloseParty :execrows
-- Host-only close; idempotent (already-closed rows match 0).
UPDATE watch_parties SET closed_at = now()
WHERE id = $1 AND host_id = $2 AND closed_at IS NULL;

-- name: ClosePartyByID :execrows
-- The idle sweeper's close (no host check).
UPDATE watch_parties SET closed_at = now()
WHERE id = $1 AND closed_at IS NULL;

-- name: ListOpenPartyIDs :many
-- Every open room, for the idle sweeper.
SELECT id, created_at FROM watch_parties WHERE closed_at IS NULL;

-- name: ListOpenPartiesVisible :many
-- Discovery. viewer is NULL for anonymous (public rooms only); a signed-in
-- viewer also sees followers/invite rooms whose host they follow or are
-- friends with, and their own. Optional episode filter.
SELECT sqlc.embed(watch_parties), sqlc.embed(episodes), sqlc.embed(anime),
       users.username AS host_username, users.avatar_url AS host_avatar_url
FROM watch_parties
JOIN episodes ON episodes.id = watch_parties.episode_id
JOIN anime    ON anime.id = episodes.anime_id
JOIN users    ON users.id = watch_parties.host_id
WHERE watch_parties.closed_at IS NULL
  AND (sqlc.narg('anime_id')::bigint IS NULL OR anime.id = sqlc.narg('anime_id')::bigint)
  AND (sqlc.narg('episode')::int IS NULL OR episodes.number = sqlc.narg('episode')::int)
  AND (
    watch_parties.visibility = 'public'
    OR (sqlc.narg('viewer')::bigint IS NOT NULL AND (
      watch_parties.host_id = sqlc.narg('viewer')::bigint
      OR (watch_parties.visibility = 'followers' AND EXISTS (
        SELECT 1 FROM follows
        WHERE follows.follower_id = sqlc.narg('viewer')::bigint AND follows.followee_id = watch_parties.host_id))
      OR EXISTS (
        SELECT 1 FROM friendships
        WHERE friendships.user_a = LEAST(sqlc.narg('viewer')::bigint, watch_parties.host_id)
          AND friendships.user_b = GREATEST(sqlc.narg('viewer')::bigint, watch_parties.host_id))
    ))
  )
ORDER BY watch_parties.created_at DESC
LIMIT $1;
