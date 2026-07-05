-- name: GetReview :one
SELECT sqlc.embed(reviews), sqlc.embed(users), sqlc.embed(anime)
FROM reviews
JOIN users ON users.id = reviews.user_id
JOIN anime ON anime.id = reviews.anime_id
WHERE reviews.id = $1 AND reviews.deleted_at IS NULL;

-- name: GetReviewRow :one
SELECT * FROM reviews WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserReviewForAnime :one
SELECT * FROM reviews
WHERE user_id = $1 AND anime_id = $2 AND deleted_at IS NULL;

-- name: CreateReview :one
INSERT INTO reviews (user_id, anime_id, body, score, has_spoilers)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateReview :one
UPDATE reviews SET body = $3, score = $4, has_spoilers = $5
WHERE user_id = $1 AND anime_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteReview :execrows
UPDATE reviews SET deleted_at = now()
WHERE id = $1 AND deleted_at IS NULL;

-- name: ListReviewsForAnime :many
SELECT sqlc.embed(reviews), sqlc.embed(users)
FROM reviews
JOIN users ON users.id = reviews.user_id
WHERE reviews.anime_id = $1 AND reviews.deleted_at IS NULL
ORDER BY reviews.helpful_count DESC, reviews.created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListReviewsByUser :many
SELECT sqlc.embed(reviews), sqlc.embed(anime)
FROM reviews
JOIN anime ON anime.id = reviews.anime_id
WHERE reviews.user_id = $1 AND reviews.deleted_at IS NULL
ORDER BY reviews.created_at DESC
LIMIT $2 OFFSET $3;

-- name: AddReviewVote :execrows
INSERT INTO review_votes (review_id, user_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveReviewVote :execrows
DELETE FROM review_votes WHERE review_id = $1 AND user_id = $2;

-- name: AdjustHelpfulCount :one
UPDATE reviews SET helpful_count = helpful_count + $2
WHERE id = $1
RETURNING helpful_count;

-- name: UserVotesForReviews :many
SELECT review_id FROM review_votes
WHERE user_id = $1 AND review_id = ANY($2::bigint[]);
