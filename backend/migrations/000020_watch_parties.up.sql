-- Watch parties (docs/WATCH_PARTIES.md, milestone M4): the durable shell of a
-- room. Live state (members, clock) lives in Redis; Postgres keeps who hosted
-- what, when, and how visible it was — for history and moderation.
CREATE TYPE party_visibility AS ENUM ('public', 'followers', 'invite');

CREATE TABLE watch_parties (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  episode_id BIGINT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  host_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility party_visibility NOT NULL DEFAULT 'followers',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);

-- Discovery: "N parties watching tonight" scans open rooms per episode.
CREATE INDEX watch_parties_open_episode_idx ON watch_parties (episode_id) WHERE closed_at IS NULL;
-- A host runs one room at a time; starting another closes the previous one
-- in the same transaction (see internal/parties).
CREATE UNIQUE INDEX watch_parties_one_open_per_host_idx ON watch_parties (host_id) WHERE closed_at IS NULL;
CREATE INDEX watch_parties_host_idx ON watch_parties (host_id, created_at DESC);
