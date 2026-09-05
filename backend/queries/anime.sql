-- name: UpsertAnime :one
INSERT INTO anime (
  anilist_id, title_romaji, title_english, title_native, synonyms, description,
  format, status, season, season_year, episodes_count, duration_min, genres,
  tags, studios, cover_image, cover_color, banner_image, average_score,
  popularity, anilist_trending, is_adult, next_airing_at, next_airing_episode,
  mal_id, synced_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
  $18, $19, $20, $21, $22, $23, $24, $25, now()
)
ON CONFLICT (anilist_id) DO UPDATE SET
  title_romaji = EXCLUDED.title_romaji,
  title_english = EXCLUDED.title_english,
  title_native = EXCLUDED.title_native,
  synonyms = EXCLUDED.synonyms,
  description = EXCLUDED.description,
  format = EXCLUDED.format,
  status = EXCLUDED.status,
  season = EXCLUDED.season,
  season_year = EXCLUDED.season_year,
  episodes_count = EXCLUDED.episodes_count,
  duration_min = EXCLUDED.duration_min,
  genres = EXCLUDED.genres,
  tags = EXCLUDED.tags,
  studios = EXCLUDED.studios,
  cover_image = EXCLUDED.cover_image,
  cover_color = EXCLUDED.cover_color,
  banner_image = EXCLUDED.banner_image,
  average_score = EXCLUDED.average_score,
  popularity = EXCLUDED.popularity,
  anilist_trending = EXCLUDED.anilist_trending,
  is_adult = EXCLUDED.is_adult,
  next_airing_at = EXCLUDED.next_airing_at,
  next_airing_episode = EXCLUDED.next_airing_episode,
  mal_id = EXCLUDED.mal_id,
  synced_at = now()
RETURNING id;

-- name: GetAnime :one
SELECT * FROM anime WHERE id = $1;

-- name: GetAnimeByAniListID :one
SELECT * FROM anime WHERE anilist_id = $1;

-- name: ListAnimeByIDs :many
SELECT * FROM anime WHERE id = ANY($1::bigint[]);

-- name: ListSeason :many
SELECT * FROM anime
WHERE season = $1 AND season_year = $2 AND is_adult = FALSE
ORDER BY popularity DESC
LIMIT $3;

-- name: BrowseAnime :many
SELECT * FROM anime
WHERE is_adult = FALSE
  AND (sqlc.narg('genre')::text IS NULL OR sqlc.narg('genre') = ANY(genres))
  AND (sqlc.narg('season_year')::int IS NULL OR season_year = sqlc.narg('season_year'))
  AND (sqlc.narg('season')::anime_season IS NULL OR season = sqlc.narg('season'))
  AND (sqlc.narg('status')::anime_status IS NULL OR status = sqlc.narg('status'))
ORDER BY popularity DESC
LIMIT $1 OFFSET $2;

-- name: SearchAnime :many
-- Blended full-text + trigram rank: FTS matches word queries; WORD
-- similarity (<%) rescues typos — it compares the query against the
-- best-matching word, so "friren" finds "Sousou no Frieren" even though
-- whole-title similarity would be far below threshold.
SELECT sqlc.embed(anime),
  GREATEST(
    ts_rank(search_doc, websearch_to_tsquery('simple', @query::text)),
    word_similarity(@query, title_romaji),
    word_similarity(@query, coalesce(title_english, ''))
  )::float8 AS rank
FROM anime
WHERE is_adult = FALSE
  AND (
    search_doc @@ websearch_to_tsquery('simple', @query)
    OR @query <% title_romaji
    OR @query <% coalesce(title_english, '')
  )
ORDER BY rank DESC, popularity DESC
LIMIT $1;

-- name: UpsertEpisode :exec
INSERT INTO episodes (anime_id, number, title, airing_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (anime_id, number) DO UPDATE SET
  title = COALESCE(EXCLUDED.title, episodes.title),
  airing_at = COALESCE(EXCLUDED.airing_at, episodes.airing_at);

-- name: EnsureEpisodes :exec
-- Create bare rows 1..N for an anime so episode threads always have an
-- anchor; airing sync fills in air times later. N is the greater of the
-- caller's count and the highest episode already on record: AniList leaves
-- `episodes` null on open-ended runs (One Piece), where a schedule entry is
-- the only proof of how far the show has actually got, and a lone row at
-- 1177 would otherwise be the whole list.
INSERT INTO episodes (anime_id, number)
SELECT $1, generate_series(
  1,
  GREATEST($2::int, COALESCE((SELECT max(number) FROM episodes WHERE anime_id = $1), 0))
)
ON CONFLICT (anime_id, number) DO NOTHING;

-- name: ListEpisodes :many
SELECT * FROM episodes WHERE anime_id = $1 ORDER BY number;

-- name: ListAiringBetween :many
SELECT sqlc.embed(episodes), sqlc.embed(anime)
FROM episodes
JOIN anime ON anime.id = episodes.anime_id
WHERE episodes.airing_at >= $1 AND episodes.airing_at < $2 AND anime.is_adult = FALSE
ORDER BY episodes.airing_at;

-- name: ListReleasingAnime :many
SELECT id, anilist_id FROM anime WHERE status = 'RELEASING';

-- name: MatchAnimeByAniListIDs :many
SELECT id, anilist_id FROM anime WHERE anilist_id = ANY($1::int[]);

-- name: MatchAnimeByMALIDs :many
SELECT id, mal_id FROM anime WHERE mal_id = ANY($1::int[]);

-- name: MatchAnimeByTitle :many
-- Import matching fallback: whole-title trigram similarity (not
-- word_similarity — import titles are complete titles, and word matching
-- would score "Death Note" a perfect 1.0 against "Death Note: Rewrite").
-- The % prefilter keeps the GIN indexes in play; synonyms join the ranking
-- but not the filter (unnest can't use an index). No is_adult filter:
-- private lists legitimately track what the browse surfaces hide.
SELECT sqlc.embed(anime),
  GREATEST(
    similarity(@query::text, title_romaji),
    similarity(@query, coalesce(title_english, '')),
    (SELECT COALESCE(MAX(similarity(@query, s)), 0::real) FROM unnest(synonyms) AS s)
  )::float8 AS similarity
FROM anime
WHERE title_romaji % @query OR coalesce(title_english, '') % @query
ORDER BY similarity DESC, popularity DESC
LIMIT $1;

