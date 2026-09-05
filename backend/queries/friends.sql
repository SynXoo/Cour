-- Friends (docs/PHASE_2.md §M3.9): pending requests, ordered friendships,
-- friend-to-friend recommendations, and the people-finding queries.

-- name: CreateFriendRequest :execrows
INSERT INTO friend_requests (requester_id, addressee_id, note)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: DeleteFriendRequest :execrows
DELETE FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2;

-- name: FriendRequestExists :one
SELECT EXISTS(SELECT 1 FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2);

-- name: CreateFriendship :execrows
INSERT INTO friendships (user_a, user_b)
VALUES (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint))
ON CONFLICT DO NOTHING;

-- name: DeleteFriendship :execrows
DELETE FROM friendships
WHERE user_a = LEAST($1::bigint, $2::bigint) AND user_b = GREATEST($1::bigint, $2::bigint);

-- name: AreFriends :one
SELECT EXISTS(
  SELECT 1 FROM friendships
  WHERE user_a = LEAST($1::bigint, $2::bigint) AND user_b = GREATEST($1::bigint, $2::bigint)
);

-- name: FriendCount :one
SELECT COUNT(*)::bigint FROM friendships WHERE user_a = $1 OR user_b = $1;

-- name: ListFriends :many
-- The other side of every friendship row the user is on, newest first.
SELECT users.id, users.username, users.avatar_url, friendships.created_at AS since
FROM friendships
JOIN users ON users.id = CASE WHEN friendships.user_a = $1 THEN friendships.user_b ELSE friendships.user_a END
WHERE friendships.user_a = $1 OR friendships.user_b = $1
ORDER BY friendships.created_at DESC
LIMIT $2;

-- name: ListIncomingFriendRequests :many
SELECT users.username, users.avatar_url, friend_requests.note, friend_requests.created_at
FROM friend_requests
JOIN users ON users.id = friend_requests.requester_id
WHERE friend_requests.addressee_id = $1
ORDER BY friend_requests.created_at DESC
LIMIT 100;

-- name: ListOutgoingFriendRequests :many
SELECT users.username, users.avatar_url, friend_requests.note, friend_requests.created_at
FROM friend_requests
JOIN users ON users.id = friend_requests.addressee_id
WHERE friend_requests.requester_id = $1
ORDER BY friend_requests.created_at DESC
LIMIT 100;

-- name: SuggestedFriends :many
-- Mutual follows who aren't friends yet and have no request pending either
-- way: the cheapest honest "people you may know".
SELECT users.username, users.avatar_url
FROM follows mine
JOIN follows theirs ON theirs.follower_id = mine.followee_id AND theirs.followee_id = mine.follower_id
JOIN users ON users.id = mine.followee_id
WHERE mine.follower_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM friendships f
    WHERE f.user_a = LEAST($1::bigint, users.id) AND f.user_b = GREATEST($1::bigint, users.id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM friend_requests r
    WHERE (r.requester_id = $1 AND r.addressee_id = users.id)
       OR (r.requester_id = users.id AND r.addressee_id = $1)
  )
ORDER BY theirs.created_at DESC
LIMIT 12;

-- name: FriendsOnAnime :many
-- Every friend who has the show on their list: watching first (furthest
-- along at the top), then completed, then the rest.
SELECT users.username, users.avatar_url,
       list_entries.status, list_entries.progress, list_entries.score
FROM friendships
JOIN users ON users.id = CASE WHEN friendships.user_a = $1 THEN friendships.user_b ELSE friendships.user_a END
JOIN list_entries ON list_entries.user_id = users.id AND list_entries.anime_id = $2
WHERE friendships.user_a = $1 OR friendships.user_b = $1
ORDER BY
  CASE list_entries.status
    WHEN 'watching' THEN 0 WHEN 'completed' THEN 1 WHEN 'paused' THEN 2
    WHEN 'planning' THEN 3 ELSE 4 END,
  list_entries.progress DESC,
  users.username;

-- name: UpsertRecommendation :one
-- Re-recommending the same show to the same friend refreshes the note and
-- bumps it back to the top instead of adding a second row.
INSERT INTO anime_recommendations (from_user_id, to_user_id, anime_id, note)
VALUES ($1, $2, $3, $4)
ON CONFLICT (from_user_id, to_user_id, anime_id) DO UPDATE SET
  note = EXCLUDED.note,
  created_at = now()
RETURNING *;

-- name: RecommendationsForAnime :many
-- Who recommended this show to the viewer, and why.
SELECT users.username, users.avatar_url, anime_recommendations.note, anime_recommendations.created_at
FROM anime_recommendations
JOIN users ON users.id = anime_recommendations.from_user_id
WHERE anime_recommendations.to_user_id = $1 AND anime_recommendations.anime_id = $2
ORDER BY anime_recommendations.created_at DESC;

-- name: ListFriendRecommendations :many
-- The home's "friends think you'd like" row: shows friends sent the viewer
-- that aren't on their list yet, newest first.
SELECT sqlc.embed(anime), users.username, users.avatar_url,
       anime_recommendations.note, anime_recommendations.created_at
FROM anime_recommendations
JOIN anime ON anime.id = anime_recommendations.anime_id
JOIN users ON users.id = anime_recommendations.from_user_id
WHERE anime_recommendations.to_user_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM list_entries le
    WHERE le.user_id = $1 AND le.anime_id = anime_recommendations.anime_id
  )
ORDER BY anime_recommendations.created_at DESC
LIMIT $2;

-- name: SearchUsers :many
-- Prefix matches first, then trigram neighbours (typo tolerance), for the
-- "find people" box.
SELECT users.username, users.avatar_url
FROM users
WHERE users.username::text ILIKE $1::text || '%'
   OR users.username::text % $1::text
ORDER BY (users.username::text ILIKE $1::text || '%') DESC,
         similarity(users.username::text, $1::text) DESC,
         users.username
LIMIT 10;

-- name: GetUsersByUsernames :many
-- Mention resolution: usernames are citext, callers pass them lowercased.
SELECT id, username FROM users WHERE lower(username::text) = ANY($1::text[]);
