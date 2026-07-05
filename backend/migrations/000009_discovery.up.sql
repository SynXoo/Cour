-- Durable snapshot of the trending ranking (Redis serves reads; this table
-- is for debuggability and cold-start after a Redis flush).

CREATE TABLE trending_scores (
  anime_id    BIGINT PRIMARY KEY REFERENCES anime(id) ON DELETE CASCADE,
  score       DOUBLE PRECISION NOT NULL,
  rank        INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX trending_scores_rank_idx ON trending_scores (rank);
