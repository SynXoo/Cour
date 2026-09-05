-- Irreversible by design: the backfilled rows are indistinguishable from
-- the stubs the sync creates, and dropping them would take real episode
-- threads with them.
SELECT 1;
