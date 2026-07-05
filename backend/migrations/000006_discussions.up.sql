-- Discussions: one series-level board per anime plus one thread per episode,
-- threaded comments with optional moment anchors (timestamp_seconds), emoji
-- reactions, and soft deletion. Threads are created lazily on first visit.

CREATE TYPE thread_kind AS ENUM ('series', 'episode');

CREATE TABLE threads (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anime_id         BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  episode_id       BIGINT REFERENCES episodes(id) ON DELETE CASCADE,
  kind             thread_kind NOT NULL,
  comment_count    INTEGER NOT NULL DEFAULT 0, -- total ever posted; tombstones keep their slot
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT threads_kind_episode CHECK (
    (kind = 'episode' AND episode_id IS NOT NULL) OR
    (kind = 'series'  AND episode_id IS NULL)
  )
);

CREATE UNIQUE INDEX threads_series_uniq ON threads (anime_id) WHERE kind = 'series';
CREATE UNIQUE INDEX threads_episode_uniq ON threads (episode_id) WHERE kind = 'episode';
CREATE INDEX threads_anime_idx ON threads (anime_id);

CREATE TABLE comments (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id         BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  parent_id         BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body              TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  timestamp_seconds INTEGER CHECK (timestamp_seconds >= 0 AND timestamp_seconds < 36000),
  has_spoilers      BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER comments_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX comments_thread_idx ON comments (thread_id, id);
CREATE INDEX comments_parent_idx ON comments (parent_id);
CREATE INDEX comments_user_idx ON comments (user_id, created_at DESC);

CREATE TABLE comment_reactions (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL CHECK (emoji IN ('+1', 'heart', 'laugh', 'surprise', 'cry', 'fire')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id, emoji)
);
