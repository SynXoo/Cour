-- Long-form reviews: one per user per anime, spoiler-taggable, helpful votes.
-- Soft-deleted (moderation requirement) — never hard-deleted.

CREATE TABLE reviews (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anime_id      BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 100 AND 20000),
  score         SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 10),
  has_spoilers  BOOLEAN NOT NULL DEFAULT FALSE,
  helpful_count INTEGER NOT NULL DEFAULT 0, -- denormalized; maintained transactionally with review_votes
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, anime_id)
);

CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX reviews_anime_idx ON reviews (anime_id, helpful_count DESC, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX reviews_user_idx ON reviews (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE review_votes (
  review_id  BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);
