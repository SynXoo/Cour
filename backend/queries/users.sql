-- name: CreateUser :one
INSERT INTO users (email, username, password_hash)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreateDiscordUser :one
INSERT INTO users (email, username, discord_id, avatar_url, email_verified_at)
VALUES ($1, $2, $3, $4, now())
RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = $1;

-- name: GetUserByDiscordID :one
SELECT * FROM users WHERE discord_id = $1;

-- name: UsernameExists :one
SELECT EXISTS(SELECT 1 FROM users WHERE username = $1);

-- name: LinkDiscord :exec
UPDATE users SET discord_id = $2, avatar_url = COALESCE(avatar_url, $3) WHERE id = $1;

-- name: MarkEmailVerified :exec
UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL;

-- name: SetPasswordHash :exec
UPDATE users SET password_hash = $2 WHERE id = $1;

-- name: UpdateProfile :one
UPDATE users SET
  bio = $2,
  avatar_url = $3,
  favorite_genres = $4,
  banner_anime_id = $5
WHERE id = $1
RETURNING *;
