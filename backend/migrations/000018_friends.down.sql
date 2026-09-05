-- Enum values cannot be dropped in place; rows of the new kinds go first,
-- then the type is rebuilt without them.
DELETE FROM notifications WHERE type IN ('friend_request', 'friend_accepted', 'mention', 'recommendation');

ALTER TYPE notification_type RENAME TO notification_type_old;
CREATE TYPE notification_type AS ENUM ('comment_reply', 'new_follower', 'episode_aired');
ALTER TABLE notifications
  ALTER COLUMN type TYPE notification_type USING type::text::notification_type;
DROP TYPE notification_type_old;

DROP TABLE dm_messages;
DROP TABLE dm_threads;
DROP TABLE anime_recommendations;
DROP TABLE friendships;
DROP TABLE friend_requests;
