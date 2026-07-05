DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I RESET pg_trgm.word_similarity_threshold', current_user);
END $$;
