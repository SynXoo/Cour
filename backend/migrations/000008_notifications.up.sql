-- Notifications, written by background jobs (asynq) — replies, new
-- followers, and new-episode alerts for shows on a watching list.

CREATE TYPE notification_type AS ENUM ('comment_reply', 'new_follower', 'episode_aired');

CREATE TABLE notifications (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  actor_id   BIGINT REFERENCES users(id) ON DELETE CASCADE,
  anime_id   BIGINT REFERENCES anime(id) ON DELETE CASCADE,
  ref_id     BIGINT,
  payload    JSONB NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
