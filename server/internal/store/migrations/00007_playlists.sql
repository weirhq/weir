-- +goose Up

CREATE TABLE playlist (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
    name text NOT NULL,
    -- Visible to everyone; each viewer sees only the items they may.
    shared boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX playlist_owner_idx ON playlist (owner_id);

CREATE TABLE playlist_item (
    playlist_id uuid NOT NULL REFERENCES playlist (id) ON DELETE CASCADE,
    position int NOT NULL,
    item_id uuid NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    PRIMARY KEY (playlist_id, position)
);

-- +goose Down

DROP TABLE playlist_item;
DROP TABLE playlist;
