-- The viewer's pulse (§M3.8): the raw material for streaks, badges, replies
-- and kudos. Everything is scoped to one user and bounded, so the home can
-- ask on every visit.

-- name: UserActiveDays :many
-- Distinct calendar days (in the viewer's zone) with any activity — the
-- streak's raw material. Bounded to ~a year: a streak longer than that is a
-- life, not a statistic.
SELECT DISTINCT (activities.created_at AT TIME ZONE @tz::text)::date AS day
FROM activities
WHERE activities.user_id = @user_id
  AND activities.created_at > now() - interval '400 days'
ORDER BY day DESC;

-- name: UserBadgeCounts :one
-- Every badge is a threshold on one of these counters.
SELECT
  (SELECT COUNT(*) FROM comments c
     WHERE c.user_id = @user_id AND c.deleted_at IS NULL)::bigint AS comments,
  (SELECT COUNT(DISTINCT t.anime_id) FROM comments c
     JOIN threads t ON t.id = c.thread_id
     WHERE c.user_id = @user_id AND c.deleted_at IS NULL)::bigint AS shows_discussed,
  (SELECT COUNT(*) FROM list_entries le
     WHERE le.user_id = @user_id AND le.status = 'completed')::bigint AS completed,
  (SELECT COUNT(*) FROM favorites f WHERE f.user_id = @user_id)::bigint AS favorites,
  (SELECT COUNT(*) FROM reviews r WHERE r.user_id = @user_id)::bigint AS reviews,
  (SELECT COUNT(*) FROM comments c
     WHERE c.user_id = @user_id AND c.deleted_at IS NULL
       AND EXTRACT(HOUR FROM c.created_at AT TIME ZONE @tz::text) < 4)::bigint AS night_comments,
  (SELECT COUNT(*) FROM comments c
     JOIN threads t ON t.id = c.thread_id
     JOIN episodes e ON e.id = t.episode_id
     WHERE c.user_id = @user_id AND c.deleted_at IS NULL
       AND e.airing_at IS NOT NULL
       AND c.created_at BETWEEN e.airing_at AND e.airing_at + interval '1 hour')::bigint AS early_comments,
  (SELECT COUNT(*) FROM comment_reactions cr
     JOIN comments c ON c.id = cr.comment_id
     WHERE c.user_id = @user_id AND cr.user_id <> @user_id)::bigint AS reactions_received,
  (SELECT COUNT(*) FROM comment_reactions cr
     JOIN comments c ON c.id = cr.comment_id
     WHERE c.user_id = @user_id AND cr.user_id <> @user_id
       AND cr.created_at > now() - interval '7 days')::bigint AS reactions_week;

-- name: RepliesToUser :many
-- Replies other people left on the viewer's comments, newest first.
SELECT c.id, c.body, c.created_at,
       actor.username AS actor_username,
       actor.avatar_url AS actor_avatar,
       sqlc.embed(anime),
       episodes.number AS episode_number,
       threads.kind AS thread_kind,
       parent.body AS parent_body
FROM comments c
JOIN comments parent ON parent.id = c.parent_id
JOIN users actor ON actor.id = c.user_id
JOIN threads ON threads.id = c.thread_id
JOIN anime ON anime.id = threads.anime_id
LEFT JOIN episodes ON episodes.id = threads.episode_id
WHERE parent.user_id = @user_id
  AND c.user_id <> @user_id
  AND c.deleted_at IS NULL
ORDER BY c.created_at DESC
LIMIT @lim;

-- name: UserTopReactedComments :many
-- The viewer's comments that drew reactions this week, most-reacted first.
SELECT c.id, c.body,
       sqlc.embed(anime),
       episodes.number AS episode_number,
       threads.kind AS thread_kind,
       COUNT(*)::bigint AS reactions
FROM comments c
JOIN comment_reactions cr ON cr.comment_id = c.id AND cr.user_id <> c.user_id
JOIN threads ON threads.id = c.thread_id
JOIN anime ON anime.id = threads.anime_id
LEFT JOIN episodes ON episodes.id = threads.episode_id
WHERE c.user_id = @user_id
  AND c.deleted_at IS NULL
  AND cr.created_at > now() - interval '7 days'
GROUP BY c.id, anime.id, episodes.number, threads.kind
ORDER BY reactions DESC, c.created_at DESC
LIMIT 3;
