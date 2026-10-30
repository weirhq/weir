-- +goose Up

-- A user's history with an item: where they stopped, whether they've
-- watched it, and how often. Music keeps play counts, not positions.
CREATE TABLE playback_state (
    user_id uuid NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
    item_id uuid NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    position_ms bigint NOT NULL DEFAULT 0,
    watched boolean NOT NULL DEFAULT false,
    play_count int NOT NULL DEFAULT 0,
    last_played timestamptz,
    -- Whether the current play has been counted, so passing the threshold
    -- twice in one sitting counts once. A restart near the beginning
    -- clears it.
    counted boolean NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, item_id)
);

CREATE INDEX playback_state_continue_idx ON playback_state (user_id, last_played DESC)
    WHERE NOT watched AND position_ms > 0;

-- +goose Down

DROP TABLE playback_state;
