-- name: RecentAnimeActivity :many
-- Raw signal for the trending recompute: every anime-linked activity in the
-- window. Decay math happens in Go where it's unit-testable.
SELECT anime_id, type, created_at
FROM activities
WHERE created_at > $1 AND anime_id IS NOT NULL;

-- name: UpstreamTrendingSignal :many
SELECT id AS anime_id, anilist_trending
FROM anime
WHERE anilist_trending > 0 AND is_adult = FALSE;

-- name: ReplaceTrendingScores :exec
DELETE FROM trending_scores;

-- name: InsertTrendingScore :exec
INSERT INTO trending_scores (anime_id, score, rank, computed_at)
VALUES ($1, $2, $3, $4);

-- name: HiddenGems :many
-- Recent, well-rated, under-watched: the deliberate inversion of the
-- popularity bias. The percentile subquery keeps "low popularity" relative
-- to the current catalog rather than a magic constant.
SELECT anime.* FROM anime
WHERE anime.season_year >= $1
  AND anime.is_adult = FALSE
  AND anime.average_score IS NOT NULL
  AND anime.popularity >= 100 -- floor: below this, scores are noise
  AND anime.average_score >= $2
  AND anime.popularity <= (
    SELECT percentile_cont(0.35) WITHIN GROUP (ORDER BY pool.popularity)
    FROM anime pool
    WHERE pool.season_year >= $1
      AND pool.is_adult = FALSE
      AND pool.average_score IS NOT NULL
      AND pool.popularity >= 100
  )
ORDER BY anime.average_score DESC, anime.popularity ASC
LIMIT $3;

-- name: TasteSet :many
-- A user's taste = favorites plus anything they scored 8+.
SELECT favorites.anime_id FROM favorites WHERE favorites.user_id = $1
UNION
SELECT list_entries.anime_id FROM list_entries
WHERE list_entries.user_id = $1 AND list_entries.score >= 8;

-- Taste-neighbor discovery is split into favorites/high-score halves (the
-- Go layer unions them) because sqlc's analyzer can't see through derived
-- tables over UNIONs.

-- name: FavoriteNeighborIDs :many
SELECT DISTINCT favorites.user_id FROM favorites
WHERE favorites.anime_id = ANY($1::bigint[]) AND favorites.user_id <> $2
LIMIT 200;

-- name: HighScoreNeighborIDs :many
SELECT DISTINCT list_entries.user_id FROM list_entries
WHERE list_entries.anime_id = ANY($1::bigint[])
  AND list_entries.score >= 8
  AND list_entries.user_id <> $2
LIMIT 200;

-- name: FavoriteRowsForUsers :many
SELECT favorites.user_id, favorites.anime_id FROM favorites
WHERE favorites.user_id = ANY($1::bigint[]);

-- name: HighScoreRowsForUsers :many
SELECT list_entries.user_id, list_entries.anime_id FROM list_entries
WHERE list_entries.user_id = ANY($1::bigint[]) AND list_entries.score >= 8;

-- name: NeighborSignals :many
-- What the chosen neighbors are watching now or rated highly recently,
-- excluding anime already on the caller's list.
SELECT le.user_id, le.anime_id, le.status, le.score, le.updated_at
FROM list_entries le
WHERE le.user_id = ANY($1::bigint[])
  AND (le.status = 'watching' OR (le.score >= 8 AND le.updated_at > $2))
  AND le.anime_id NOT IN (
    SELECT mine.anime_id FROM list_entries mine WHERE mine.user_id = $3
  );
