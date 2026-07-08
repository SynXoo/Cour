-- Thread velocity (GET /threads/trending) scans comments by recency; the
-- existing indexes are all thread-/user-scoped.
CREATE INDEX comments_created_at_idx ON comments (created_at);
