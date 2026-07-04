-- Extensions used across the schema:
--   pg_trgm  trigram indexes for fuzzy title search
--   citext   case-insensitive uniqueness (emails, usernames)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
