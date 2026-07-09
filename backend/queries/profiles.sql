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

-- name: UserScoreHistogram :many
SELECT score::smallint AS score, COUNT(*)::bigint AS count
FROM list_entries
WHERE user_id = $1 AND score IS NOT NULL
GROUP BY score
ORDER BY score;

-- name: UserWatchMinutes :one
-- Σ progress × duration. Unknown durations count 0 — the number stays an
-- honest floor rather than a guess.
SELECT COALESCE(SUM(le.progress::bigint * COALESCE(a.duration_min, 0)), 0)::bigint AS minutes
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
WHERE le.user_id = $1;

-- name: GetBannerAnime :one
SELECT id, banner_image, cover_color FROM anime WHERE id = $1;

-- name: UserPublicList :many
-- The public library browse behind the profile tabs (M3.5): status tabs,
-- the histogram's exact-score filter, genre-bar filter, three sorts, offset
-- pages. COUNT(*) OVER() rides along so one query yields page + total.
SELECT sqlc.embed(list_entries), sqlc.embed(anime), COUNT(*) OVER ()::bigint AS total
FROM list_entries
JOIN anime ON anime.id = list_entries.anime_id
WHERE list_entries.user_id = sqlc.arg('user_id')
  AND (sqlc.narg('status')::list_status IS NULL OR list_entries.status = sqlc.narg('status'))
  AND (sqlc.narg('score')::smallint IS NULL OR list_entries.score = sqlc.narg('score'))
  AND (sqlc.narg('genre')::text IS NULL OR sqlc.narg('genre')::text = ANY(anime.genres))
ORDER BY
  CASE WHEN sqlc.arg('sort')::text = 'title'
       THEN lower(coalesce(anime.title_english, anime.title_romaji)) END ASC,
  CASE WHEN sqlc.arg('sort')::text = 'score' THEN list_entries.score END DESC NULLS LAST,
  list_entries.updated_at DESC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');
