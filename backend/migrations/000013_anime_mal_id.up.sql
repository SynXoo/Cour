-- mal_id: MyAnimeList's id for each title, sourced from AniList's Media.idMal.
-- Nullable (not every title has a MAL entry) and unique (it addresses MAL's
-- namespace). Powers the MAL XML import path (docs/PHASE_2.md §M1): imported
-- rows match on mal_id before falling back to trigram title matching.
ALTER TABLE anime ADD COLUMN mal_id INTEGER UNIQUE;

-- Existing rows were upserted before this column existed, so their mal_id is
-- NULL. Reset the full-catalog backfill cursor (owned by the anilist sync job,
-- sync_state key 'anilist_backfill') so the next worker bootstrap re-crawls the
-- whole catalog and populates mal_id from idMal. The crawl is idempotent and
-- runs for hours under the AniList rate budget; the 6-hourly delta sync keeps
-- it fresh after. Demo mode skips the crawl (fixtures are the source there).
DELETE FROM sync_state WHERE key = 'anilist_backfill';
