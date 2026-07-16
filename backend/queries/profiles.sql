-- name: UserListStatusCounts :many
SELECT status, COUNT(*) AS count
FROM list_entries WHERE user_id = $1
GROUP BY status;

-- name: UserScoreStats :one
-- STDDEV_POP is 0 over a single row and NULL over none, so the COALESCE only
-- ever fires for an unrated list; callers gate the spread on rated_count >= 2.
SELECT
  COALESCE(AVG(score), 0)::float8 AS mean_score,
  COUNT(score)::bigint AS rated_count,
  COALESCE(STDDEV_POP(score), 0)::float8 AS score_stddev
FROM list_entries
WHERE user_id = $1 AND score IS NOT NULL;

-- name: UserScoreBias :one
-- Harsh critic or soft touch: the owner's mean against AniList's, over only
-- the shows where both have an opinion. average_score is 0-100, so /10 lands
-- it on the same 1-10 scale as list_entries.score.
SELECT
  COUNT(*)::bigint AS sample_size,
  COALESCE(AVG(le.score), 0)::float8 AS user_mean,
  COALESCE(AVG(a.average_score::float8 / 10), 0)::float8 AS community_mean
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
WHERE le.user_id = $1 AND le.score IS NOT NULL AND a.average_score IS NOT NULL;

-- name: UserEpisodesWatched :one
SELECT COALESCE(SUM(progress), 0)::bigint AS episodes
FROM list_entries WHERE user_id = $1;

-- name: UserGenreBreakdown :many
-- rated_count rides along so the mean can be suppressed when it rests on
-- nothing: "9.0 across one show" is noise dressed as taste.
SELECT
  g.genre::text AS genre,
  COUNT(*)::bigint AS count,
  COUNT(le.score)::bigint AS rated_count,
  COALESCE(AVG(le.score), 0)::float8 AS mean_score
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
CROSS JOIN LATERAL unnest(a.genres) AS g(genre)
WHERE le.user_id = $1
GROUP BY g.genre
ORDER BY count DESC, genre
LIMIT 10;

-- name: UserSeasonSpread :many
-- The owner's eras: only completed shows count, because a planning list is a
-- wish, not a history.
SELECT a.season_year::int AS year, COUNT(*)::bigint AS count
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
WHERE le.user_id = $1 AND le.status = 'completed' AND a.season_year IS NOT NULL
GROUP BY a.season_year
ORDER BY a.season_year;

-- name: UserFormatSplit :many
-- COALESCE forces a non-null text out of a nullable enum column the WHERE has
-- already filtered — sqlc types the column, not the predicate.
SELECT COALESCE(a.format::text, '')::text AS format, COUNT(*)::bigint AS count
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
WHERE le.user_id = $1 AND a.format IS NOT NULL
GROUP BY a.format
ORDER BY count DESC, a.format;

-- name: UserTopStudios :many
-- studios is [{"name","is_main"}]; licensors and production committees ride in
-- the same array with is_main=false, and nobody's "most-watched studio" is
-- Aniplex.
SELECT COALESCE(s.value->>'name', '')::text AS name, COUNT(*)::bigint AS count
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
CROSS JOIN LATERAL jsonb_array_elements(a.studios) AS s(value)
WHERE le.user_id = $1
  AND (s.value->>'is_main')::boolean
  AND COALESCE(s.value->>'name', '') <> ''
GROUP BY COALESCE(s.value->>'name', '')
ORDER BY count DESC, name
LIMIT 3;

-- name: UserLongestCompleted :many
-- :many with LIMIT 1 — an empty shelf is the common case, not an error.
SELECT sqlc.embed(anime)
FROM list_entries le
JOIN anime ON anime.id = le.anime_id
WHERE le.user_id = $1 AND le.status = 'completed' AND anime.episodes_count IS NOT NULL
ORDER BY anime.episodes_count DESC, anime.id
LIMIT 1;

-- name: UserLibrarySpan :one
-- dated_count distinguishes "no shows" from "no shows with a premiere year";
-- both would otherwise arrive as the 0/0 the COALESCEs invent.
SELECT
  COUNT(a.season_year)::bigint AS dated_count,
  COALESCE(MIN(a.season_year), 0)::int AS earliest_year,
  COALESCE(MAX(a.season_year), 0)::int AS latest_year
FROM list_entries le
JOIN anime a ON a.id = le.anime_id
WHERE le.user_id = $1;

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
-- M3.6 added year + format so the era strip and the format split are clicks
-- into this same list, filtered server-side like every other stat.
SELECT sqlc.embed(list_entries), sqlc.embed(anime), COUNT(*) OVER ()::bigint AS total
FROM list_entries
JOIN anime ON anime.id = list_entries.anime_id
WHERE list_entries.user_id = sqlc.arg('user_id')
  AND (sqlc.narg('status')::list_status IS NULL OR list_entries.status = sqlc.narg('status'))
  AND (sqlc.narg('score')::smallint IS NULL OR list_entries.score = sqlc.narg('score'))
  AND (sqlc.narg('genre')::text IS NULL OR sqlc.narg('genre')::text = ANY(anime.genres))
  AND (sqlc.narg('year')::int IS NULL OR anime.season_year = sqlc.narg('year')::int)
  AND (sqlc.narg('format')::anime_format IS NULL OR anime.format = sqlc.narg('format')::anime_format)
ORDER BY
  CASE WHEN sqlc.arg('sort')::text = 'title'
       THEN lower(coalesce(anime.title_english, anime.title_romaji)) END ASC,
  CASE WHEN sqlc.arg('sort')::text = 'score' THEN list_entries.score END DESC NULLS LAST,
  list_entries.updated_at DESC
LIMIT sqlc.arg('page_limit') OFFSET sqlc.arg('page_offset');
