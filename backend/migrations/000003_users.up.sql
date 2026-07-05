-- Accounts, sessions (rotating refresh-token families), email flows.

CREATE TYPE user_role AS ENUM ('user', 'mod', 'admin');

CREATE TABLE users (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             CITEXT NOT NULL UNIQUE,
  username          CITEXT NOT NULL UNIQUE,
  password_hash     TEXT,        -- argon2id PHC string; NULL for OAuth-only accounts
  discord_id        TEXT UNIQUE, -- NULL unless linked
  avatar_url        TEXT,
  bio               TEXT NOT NULL DEFAULT '',
  favorite_genres   TEXT[] NOT NULL DEFAULT '{}',
  role              user_role NOT NULL DEFAULT 'user',
  email_verified_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  -- Every account must be able to log in somehow.
  CONSTRAINT users_has_credential CHECK (password_hash IS NOT NULL OR discord_id IS NOT NULL)
);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens rotate on every use. A family groups the chain from one
-- login; reuse of an already-used token reveals theft and revokes the family.
CREATE TABLE refresh_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id  UUID NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE, -- sha256 of the opaque token
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ, -- set when rotated away
  revoked_at TIMESTAMPTZ, -- set on logout or theft detection
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TYPE email_token_purpose AS ENUM ('verify_email', 'reset_password');

CREATE TABLE email_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    email_token_purpose NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, purpose);
