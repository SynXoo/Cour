-- User lists (the tracking core), favorites, and the activity stream.
-- Activities double as the recency signal source for trending, so every
-- list/favorite mutation records one in the same transaction.

CREATE TYPE list_status AS ENUM ('watching', 'completed', 'planning', 'paused', 'dropped');

CREATE TABLE list_entries (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anime_id    BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  status      list_status NOT NULL,
  score       SMALLINT CHECK (score BETWEEN 1 AND 10),
  progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  started_on  DATE,
  finished_on DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, anime_id)
);

CREATE TRIGGER list_entries_updated_at BEFORE UPDATE ON list_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX list_entries_user_idx ON list_entries (user_id, status, updated_at DESC);
CREATE INDEX list_entries_anime_idx ON list_entries (anime_id);

CREATE TABLE favorites (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anime_id   BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, anime_id)
);

CREATE INDEX favorites_anime_idx ON favorites (anime_id);

CREATE TYPE activity_type AS ENUM (
  'list_add',      -- title added to a list
  'status_change', -- e.g. planning -> watching
  'progress',      -- episode progress bump
  'completed',     -- finished the show
  'scored',        -- rated or re-rated
  'favorite',      -- added to favorites
  'review',        -- posted a review        (review slice)
  'comment',       -- posted a comment       (discussion slice)
  'helpful_vote'   -- found a review helpful (review slice)
);

CREATE TABLE activities (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       activity_type NOT NULL,
  anime_id   BIGINT REFERENCES anime(id) ON DELETE CASCADE,
  ref_id     BIGINT,                       -- review/comment id when applicable
  payload    JSONB NOT NULL DEFAULT '{}',  -- type-specific: {status, score, progress, ...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Feed reads: activities of my followees, newest first (keyset on id).
CREATE INDEX activities_user_idx ON activities (user_id, id DESC);
-- Trending recompute: recent window grouped by anime.
CREATE INDEX activities_anime_recent_idx ON activities (created_at, anime_id);
