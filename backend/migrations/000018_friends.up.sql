-- Friends & interactions (docs/PHASE_2.md §M3.9): friendships layered on
-- top of directed follows, friend-to-friend recommendations, direct
-- messages, and the notification kinds they produce.

-- Pending requests only: accept or decline deletes the row.
CREATE TABLE friend_requests (
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CONSTRAINT friend_requests_not_self CHECK (requester_id <> addressee_id)
);

CREATE INDEX friend_requests_addressee_idx ON friend_requests (addressee_id);

-- One row per pair whichever side asked: the smaller id is always user_a.
CREATE TABLE friendships (
  user_a     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CONSTRAINT friendships_ordered CHECK (user_a < user_b)
);

CREATE INDEX friendships_user_b_idx ON friendships (user_b);

-- "You'd like this" from one friend to another. Unique per triple so a
-- re-recommendation updates the note instead of piling up.
CREATE TABLE anime_recommendations (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anime_id     BIGINT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_user_id, anime_id),
  CONSTRAINT anime_recommendations_not_self CHECK (from_user_id <> to_user_id)
);

CREATE INDEX anime_recommendations_to_idx ON anime_recommendations (to_user_id, created_at DESC);

-- Direct messages: one thread per pair (ordered like friendships), each
-- side's read pointer on the thread itself.
CREATE TABLE dm_threads (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_a          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_a     BIGINT NOT NULL DEFAULT 0,
  last_read_b     BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b),
  CONSTRAINT dm_threads_ordered CHECK (user_a < user_b)
);

CREATE INDEX dm_threads_user_b_idx ON dm_threads (user_b);

CREATE TABLE dm_messages (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id  BIGINT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dm_messages_thread_idx ON dm_messages (thread_id, id DESC);

-- New notification kinds. ADD VALUE is fine inside the migration's implicit
-- transaction on PG 17 as long as nothing in the same transaction uses it.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'friend_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'friend_accepted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'mention';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'recommendation';
