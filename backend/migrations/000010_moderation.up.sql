-- Moderation: user reports against content, resolved by mods.

CREATE TYPE report_subject AS ENUM ('review', 'comment', 'user');
CREATE TYPE report_status AS ENUM ('open', 'resolved', 'dismissed');

CREATE TABLE reports (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_type report_subject NOT NULL,
  subject_id   BIGINT NOT NULL,
  reason       TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  status       report_status NOT NULL DEFAULT 'open',
  resolved_by  BIGINT REFERENCES users(id),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reports_open_idx ON reports (id) WHERE status = 'open';
-- One open report per (reporter, subject): repeat reports are no-ops.
CREATE UNIQUE INDEX reports_dedup_idx ON reports (reporter_id, subject_type, subject_id)
  WHERE status = 'open';
