-- Catalog: anime + episodes, synced from AniList.

-- Shared trigger to maintain updated_at on any table that has the column.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- array_to_string() is only STABLE, which disqualifies it from generated
-- columns; for text[] it is de-facto immutable, so wrap it.
CREATE FUNCTION immutable_join(arr TEXT[], sep TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN array_to_string(arr, sep);

-- Enum values mirror AniList's vocabulary exactly so sync is a straight copy.
CREATE TYPE anime_format AS ENUM ('TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC');
CREATE TYPE anime_status AS ENUM ('FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS');
CREATE TYPE anime_season AS ENUM ('WINTER', 'SPRING', 'SUMMER', 'FALL');

CREATE TABLE anime (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anilist_id          INTEGER NOT NULL UNIQUE,
  title_romaji        TEXT NOT NULL,
  title_english       TEXT,
  title_native        TEXT,
  synonyms            TEXT[] NOT NULL DEFAULT '{}',
  description         TEXT, -- AniList markup; sanitized at render time
  format              anime_format,
  status              anime_status NOT NULL DEFAULT 'NOT_YET_RELEASED',
  season              anime_season,
  season_year         INTEGER,
  episodes_count      INTEGER, -- announced total; NULL while unknown
  duration_min        INTEGER,
  genres              TEXT[] NOT NULL DEFAULT '{}',
  tags                JSONB NOT NULL DEFAULT '[]', -- [{"name","rank"}]
  studios             JSONB NOT NULL DEFAULT '[]', -- [{"name","is_main"}]
  cover_image         TEXT,
  cover_color         TEXT,
  banner_image        TEXT,
  average_score       INTEGER, -- AniList community mean, 0-100
  popularity          INTEGER NOT NULL DEFAULT 0, -- AniList list count
  anilist_trending    INTEGER NOT NULL DEFAULT 0, -- upstream trending signal, blended into ours
  is_adult            BOOLEAN NOT NULL DEFAULT FALSE,
  next_airing_at      TIMESTAMPTZ,
  next_airing_episode INTEGER,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'simple' config: titles are proper nouns/romaji — stemming would mangle
  -- them; typo-tolerance comes from the trigram indexes below.
  search_doc TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title_romaji, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(title_english, '')), 'A') ||
    setweight(to_tsvector('simple', immutable_join(synonyms, ' ')), 'B') ||
    setweight(to_tsvector('simple', immutable_join(genres, ' ')), 'C')
  ) STORED
);

CREATE TRIGGER anime_updated_at BEFORE UPDATE ON anime
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX anime_search_doc_idx ON anime USING GIN (search_doc);
CREATE INDEX anime_title_romaji_trgm_idx ON anime USING GIN (title_romaji gin_trgm_ops);
CREATE INDEX anime_title_english_trgm_idx ON anime USING GIN (coalesce(title_english, '') gin_trgm_ops);
CREATE INDEX anime_season_idx ON anime (season_year DESC, season);
CREATE INDEX anime_popularity_idx ON anime (popularity DESC);
CREATE INDEX anime_status_idx ON anime (status) WHERE status = 'RELEASING';

CREATE TABLE episodes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anime_id   BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  number     INTEGER NOT NULL,
  title      TEXT,
  airing_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (anime_id, number)
);

-- The weekly schedule view scans a time window across all anime.
CREATE INDEX episodes_airing_at_idx ON episodes (airing_at) WHERE airing_at IS NOT NULL;
