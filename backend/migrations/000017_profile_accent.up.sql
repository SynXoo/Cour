-- Profile accent (M3.6): the owner picks the color the profile page is washed
-- in, normally lifted straight from a favorite's AniList cover art. Stored as
-- a lowercase #rrggbb; NULL keeps the derived behaviour the profile shipped
-- with (banner's cover_color, else the first favorite that has one). The
-- service lowercases before writing, so a case-sensitive CHECK is the loud
-- kind of constraint: it fires on a bug, never on user input.
ALTER TABLE users ADD COLUMN accent_color TEXT
  CONSTRAINT users_accent_color_hex CHECK (accent_color ~ '^#[0-9a-f]{6}$');
