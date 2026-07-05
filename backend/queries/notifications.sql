-- name: InsertNotification :exec
INSERT INTO notifications (user_id, type, actor_id, anime_id, ref_id, payload)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: ListNotifications :many
SELECT sqlc.embed(notifications), actor.username AS actor_username, actor.avatar_url AS actor_avatar
FROM notifications
LEFT JOIN users actor ON actor.id = notifications.actor_id
WHERE notifications.user_id = $1 AND notifications.id < $2
ORDER BY notifications.id DESC
LIMIT $3;

-- name: CountUnreadNotifications :one
SELECT COUNT(*)::bigint FROM notifications
WHERE user_id = $1 AND read_at IS NULL;

-- name: MarkNotificationsRead :exec
UPDATE notifications SET read_at = now()
WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL;

-- name: MarkAllNotificationsRead :exec
UPDATE notifications SET read_at = now()
WHERE user_id = $1 AND read_at IS NULL;

-- name: AiredEpisodesBetween :many
SELECT sqlc.embed(episodes), sqlc.embed(anime)
FROM episodes
JOIN anime ON anime.id = episodes.anime_id
WHERE episodes.airing_at > $1 AND episodes.airing_at <= $2;

-- name: WatcherIDs :many
SELECT user_id FROM list_entries
WHERE anime_id = $1 AND status = 'watching';
