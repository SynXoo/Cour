-- Profile banner (M3.5): the profile hero shows a chosen anime's AniList
-- banner art. No uploads — banner imagery is always catalog art, so there is
-- no storage or moderation surface (parity with URL-based avatars).
ALTER TABLE users ADD COLUMN banner_anime_id BIGINT REFERENCES anime(id) ON DELETE SET NULL;
