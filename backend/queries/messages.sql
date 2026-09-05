-- Direct messages (docs/PHASE_2.md §M3.9): one thread per pair, each side's
-- read pointer on the thread row, keyset pages of messages.

-- name: GetOrCreateDMThread :one
-- The no-op DO UPDATE makes ON CONFLICT return the existing row.
INSERT INTO dm_threads (user_a, user_b)
VALUES (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint))
ON CONFLICT (user_a, user_b) DO UPDATE SET user_a = EXCLUDED.user_a
RETURNING *;

-- name: GetDMThread :one
SELECT * FROM dm_threads
WHERE user_a = LEAST($1::bigint, $2::bigint) AND user_b = GREATEST($1::bigint, $2::bigint);

-- name: InsertDMMessage :one
INSERT INTO dm_messages (thread_id, sender_id, body)
VALUES ($1, $2, $3)
RETURNING *;

-- name: TouchDMThread :exec
-- After a send: bump recency and move the sender's own pointer past their
-- message so their inbox never shows their own words as unread.
UPDATE dm_threads SET
  last_message_at = now(),
  last_read_a = CASE WHEN user_a = @sender::bigint THEN GREATEST(last_read_a, @message::bigint) ELSE last_read_a END,
  last_read_b = CASE WHEN user_b = @sender::bigint THEN GREATEST(last_read_b, @message::bigint) ELSE last_read_b END
WHERE id = @thread;

-- name: ListDMMessages :many
SELECT * FROM dm_messages
WHERE thread_id = $1 AND id < $2
ORDER BY id DESC
LIMIT $3;

-- name: MarkDMThreadRead :exec
UPDATE dm_threads SET
  last_read_a = CASE WHEN user_a = @viewer::bigint
    THEN GREATEST(last_read_a, (SELECT COALESCE(MAX(m.id), 0) FROM dm_messages m WHERE m.thread_id = @thread))
    ELSE last_read_a END,
  last_read_b = CASE WHEN user_b = @viewer::bigint
    THEN GREATEST(last_read_b, (SELECT COALESCE(MAX(m.id), 0) FROM dm_messages m WHERE m.thread_id = @thread))
    ELSE last_read_b END
WHERE id = @thread;

-- name: ListDMInbox :many
-- Every conversation the viewer is in, newest activity first, with the
-- peer, the last message, and how many of the peer's messages are past
-- the viewer's read pointer.
SELECT dm_threads.id AS thread_id,
       peer.username AS peer_username, peer.avatar_url AS peer_avatar,
       last.body AS last_body, last.sender_id AS last_sender_id, last.created_at AS last_at,
       (SELECT COUNT(*) FROM dm_messages m
         WHERE m.thread_id = dm_threads.id
           AND m.sender_id <> @viewer::bigint
           AND m.id > CASE WHEN dm_threads.user_a = @viewer::bigint THEN dm_threads.last_read_a ELSE dm_threads.last_read_b END
       )::bigint AS unread
FROM dm_threads
JOIN users peer ON peer.id = CASE WHEN dm_threads.user_a = @viewer::bigint THEN dm_threads.user_b ELSE dm_threads.user_a END
JOIN LATERAL (
  SELECT body, sender_id, created_at FROM dm_messages
  WHERE thread_id = dm_threads.id ORDER BY id DESC LIMIT 1
) last ON TRUE
WHERE dm_threads.user_a = @viewer::bigint OR dm_threads.user_b = @viewer::bigint
ORDER BY dm_threads.last_message_at DESC
LIMIT 50;

-- name: CountUnreadDMs :one
SELECT COALESCE(SUM(t.unread), 0)::bigint FROM (
  SELECT (SELECT COUNT(*) FROM dm_messages m
           WHERE m.thread_id = dm_threads.id
             AND m.sender_id <> @viewer::bigint
             AND m.id > CASE WHEN dm_threads.user_a = @viewer::bigint THEN dm_threads.last_read_a ELSE dm_threads.last_read_b END
         ) AS unread
  FROM dm_threads
  WHERE dm_threads.user_a = @viewer::bigint OR dm_threads.user_b = @viewer::bigint
) t;
