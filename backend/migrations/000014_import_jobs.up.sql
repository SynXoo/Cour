-- Import jobs: durable, resumable state for list imports (docs/PHASE_2.md §M1).
-- One row per import attempt: source parameters, the parsed+matched rows as
-- jsonb (the preview the UI reviews), stage counts, and a failure reason.
-- Rows are written once by the processing step and read back at commit, so
-- the job doubles as the debugging artifact when an import goes wrong.

CREATE TYPE import_source AS ENUM ('anilist', 'mal');

CREATE TYPE import_status AS ENUM (
  'pending',     -- created, queued for processing
  'processing',  -- fetch/parse/match running in the worker
  'ready',       -- preview available, awaiting commit
  'committing',  -- apply transaction in flight
  'done',        -- applied
  'failed',      -- fetch or parse error (see error column)
  'superseded'   -- replaced by a newer import before commit
);

CREATE TABLE import_jobs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source     import_source NOT NULL,
  status     import_status NOT NULL DEFAULT 'pending',
  payload    JSONB NOT NULL DEFAULT '{}', -- source params: {"username"} / {"filename"}
  rows       JSONB,                       -- parsed+matched entries; null until parsed
  counts     JSONB NOT NULL DEFAULT '{}', -- {total,matched,review,conflicts,applied,skipped}
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER import_jobs_updated_at BEFORE UPDATE ON import_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX import_jobs_user_idx ON import_jobs (user_id, created_at DESC);

-- The "one live import per user" rule, enforced where it can't race: a user
-- may have at most one job actively fetching, matching, or writing. 'ready'
-- is deliberately not in the predicate — an abandoned preview must not block
-- a fresh import (creating one supersedes it instead).
CREATE UNIQUE INDEX import_jobs_one_active_idx ON import_jobs (user_id)
  WHERE status IN ('pending', 'processing', 'committing');
