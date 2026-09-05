-- name: Follow :execrows
INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: Unfollow :execrows
DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2;

-- name: IsFollowing :one
SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2);

-- name: FollowCounts :one
SELECT
  COUNT(*) FILTER (WHERE followee_id = $1)::bigint AS followers,
  COUNT(*) FILTER (WHERE follower_id = $1)::bigint AS following
FROM follows
WHERE followee_id = $1 OR follower_id = $1;

-- name: ListFollowers :many
SELECT users.username, users.avatar_url
FROM follows JOIN users ON users.id = follows.follower_id
WHERE follows.followee_id = $1
ORDER BY follows.created_at DESC
LIMIT $2;

-- name: ListFollowing :many
SELECT users.username, users.avatar_url
FROM follows JOIN users ON users.id = follows.followee_id
WHERE follows.follower_id = $1
ORDER BY follows.created_at DESC
LIMIT $2;

-- name: FeedActivities :many
-- Fan-out-on-read: activities of everyone the user follows, newest first,
-- keyset-paginated on id. Progress bumps and helpful votes stay out of the
-- feed (they still count toward trending).
SELECT sqlc.embed(activities), sqlc.embed(users), sqlc.embed(anime)
FROM activities
JOIN users ON users.id = activities.user_id
JOIN anime ON anime.id = activities.anime_id
WHERE activities.user_id IN (SELECT followee_id FROM follows WHERE follower_id = $1)
  AND activities.type NOT IN ('progress', 'helpful_vote')
  AND activities.id < $2
ORDER BY activities.id DESC
LIMIT $3;

-- name: FeedActivitiesFriends :many
-- The same feed narrowed to friendships (docs/PHASE_2.md §M3.9 `scope=friends`).
SELECT sqlc.embed(activities), sqlc.embed(users), sqlc.embed(anime)
FROM activities
JOIN users ON users.id = activities.user_id
JOIN anime ON anime.id = activities.anime_id
WHERE activities.user_id IN (
    SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END
    FROM friendships WHERE user_a = $1 OR user_b = $1
  )
  AND activities.type NOT IN ('progress', 'helpful_vote')
  AND activities.id < $2
ORDER BY activities.id DESC
LIMIT $3;
