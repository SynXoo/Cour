-- Cross-restart bookkeeping for upstream sync jobs: the full-catalog backfill
-- cursor and the incremental-refresh watermark. One row per job; the JSON
-- shape is owned by the job that writes it.

CREATE TABLE sync_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
