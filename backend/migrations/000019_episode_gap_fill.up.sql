-- One-time repair for shows whose episode rows were never filled in.
--
-- Until now episode stubs were only created when AniList reported a total
-- episode count. Open-ended runs (One Piece and friends) report null, so the
-- only rows they ever got came from the airing-schedule sync — a single row
-- near the top of the run, which read on the anime page as "this show has
-- one episode". Backfill every missing number below the highest one on
-- record; the sync now keeps them filled (see EnsureEpisodes).
INSERT INTO episodes (anime_id, number)
SELECT g.anime_id, g.number
FROM (
  SELECT e.anime_id, generate_series(1, max(e.number)) AS number
  FROM episodes e
  GROUP BY e.anime_id
  HAVING max(e.number) > count(*)
) AS g
ON CONFLICT (anime_id, number) DO NOTHING;
