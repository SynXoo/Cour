-- name: UserListStatusCounts :many
SELECT status, COUNT(*) AS count
FROM list_entries WHERE user_id = $1
GROUP BY status;

-- name: UserScoreStats :one
SELECT COALESCE(AVG(score), 0)::float8 AS mean_score, COUNT(score)::bigint AS rated_count
FROM list_entries
WHERE user_id = $1 AND score IS NOT NULL;

-- name: UserEpisodesWatched :one
SELECT COALESCE(SUM(progress), 0)::bigint AS episodes
FROM list_entries WHERE user_id = $1;

-- name: UserGenreBreakdown :many
SELECT g.genre::text AS genre, COUNT(*)::bigint AS count
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
CROSS JOIN LATERAL unnest(a.genres) AS g(genre)
WHERE le.user_id = $1
GROUP BY g.genre
ORDER BY count DESC, genre
LIMIT 10;

-- name: UserCurrentlyWatching :many
SELECT sqlc.embed(anime), le.progress
FROM list_entries le
JOIN anime ON anime.id = le.anime_id
WHERE le.user_id = $1 AND le.status = 'watching'
ORDER BY le.updated_at DESC
LIMIT 12;
