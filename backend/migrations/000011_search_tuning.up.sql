-- Typo tolerance tuning: 'friren' vs 'Sousou no Frieren' word-scores 0.5,
-- and pg_trgm's default word_similarity_threshold is 0.6 — short misspelled
-- queries would miss. 0.4 keeps matches sane while rescuing typos, and the
-- <% operator stays GIN-indexable (unlike calling the function in WHERE).
-- Role-level so every new app connection inherits it (USERSET — no
-- superuser needed). Sessions opened before this migration keep the old
-- value; the API opens its pool after migrating.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I SET pg_trgm.word_similarity_threshold = 0.4', current_user);
END $$;
