-- name: GetSeriesThread :one
SELECT * FROM threads WHERE anime_id = $1 AND kind = 'series';

-- name: GetEpisodeThread :one
SELECT * FROM threads WHERE episode_id = $1 AND kind = 'episode';

-- name: GetThread :one
SELECT * FROM threads WHERE id = $1;

-- name: CreateSeriesThread :one
INSERT INTO threads (anime_id, kind) VALUES ($1, 'series')
ON CONFLICT DO NOTHING
RETURNING *;

-- name: CreateEpisodeThread :one
INSERT INTO threads (anime_id, episode_id, kind) VALUES ($1, $2, 'episode')
ON CONFLICT DO NOTHING
RETURNING *;

-- name: GetEpisodeByNumber :one
SELECT * FROM episodes WHERE anime_id = $1 AND number = $2;

-- name: BumpThread :exec
UPDATE threads SET comment_count = comment_count + 1, last_activity_at = now()
WHERE id = $1;

-- name: ListEpisodeThreadSummaries :many
SELECT episodes.number, threads.id AS thread_id, threads.comment_count, threads.last_activity_at
FROM threads
JOIN episodes ON episodes.id = threads.episode_id
WHERE threads.anime_id = $1 AND threads.kind = 'episode'
ORDER BY episodes.number;

-- name: ListComments :many
SELECT sqlc.embed(comments), sqlc.embed(users)
FROM comments
JOIN users ON users.id = comments.user_id
WHERE comments.thread_id = $1
ORDER BY comments.id
LIMIT $2;

-- name: RecentComments :many
-- Live comments in the velocity window, for thread-trending scoring.
SELECT thread_id, created_at FROM comments
WHERE created_at >= $1 AND deleted_at IS NULL;

-- name: ThreadsWithContext :many
-- Hydrates ranked thread ids with their anime and (for episode threads) the
-- episode row. Order is restored in Go from the ranked id list.
SELECT sqlc.embed(threads), sqlc.embed(anime),
       episodes.number AS episode_number,
       episodes.title AS episode_title,
       episodes.airing_at AS episode_airing_at
FROM threads
JOIN anime ON anime.id = threads.anime_id
LEFT JOIN episodes ON episodes.id = threads.episode_id
WHERE threads.id = ANY(@thread_ids::bigint[]);

-- name: CreateComment :one
INSERT INTO comments (thread_id, parent_id, user_id, body, timestamp_seconds, has_spoilers)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetComment :one
SELECT * FROM comments WHERE id = $1;

-- name: SoftDeleteComment :execrows
UPDATE comments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;

-- name: AddReaction :execrows
INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: RemoveReaction :execrows
DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3;

-- name: ReactionCounts :many
SELECT comment_id, emoji, COUNT(*)::bigint AS count
FROM comment_reactions
WHERE comment_id = ANY($1::bigint[])
GROUP BY comment_id, emoji;

-- name: ReactionCountFor :one
SELECT COUNT(*)::bigint FROM comment_reactions
WHERE comment_id = $1 AND emoji = $2;

-- name: UserReactions :many
SELECT comment_id, emoji FROM comment_reactions
WHERE user_id = $1 AND comment_id = ANY($2::bigint[]);
