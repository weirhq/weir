-- +goose Up

-- "user" is reserved in Postgres, so local accounts live in user_account.
CREATE TABLE user_account (
    id uuid PRIMARY KEY,
    username text NOT NULL,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'member')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_account_username_key ON user_account (lower(username));

-- A client a user has signed in from. Each device holds at most one refresh
-- token, replaced on every refresh and cleared on logout.
CREATE TABLE device (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
    name text NOT NULL,
    client text NOT NULL,
    client_version text NOT NULL,
    refresh_token_hash bytea,
    refresh_token_expires_at timestamptz,
    -- When the user last entered their password on this device.
    authenticated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_user_id_idx ON device (user_id);
CREATE UNIQUE INDEX device_refresh_token_hash_key ON device (refresh_token_hash);

-- The server's Ed25519 identity: signs access tokens now, federation later.
-- Exactly one row.
CREATE TABLE server_key (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    private_key bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down

DROP TABLE server_key;
DROP TABLE device;
DROP TABLE user_account;
