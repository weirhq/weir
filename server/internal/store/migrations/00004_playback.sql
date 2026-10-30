-- +goose Up

-- Per-user playback preferences. Null means no preference.
ALTER TABLE user_account
    ADD COLUMN preferred_audio_language text,
    ADD COLUMN preferred_subtitle_language text,
    -- Bits per second.
    ADD COLUMN max_bitrate bigint;

-- Playback decisions, so a repeat play costs no work. input_hash covers the
-- client's capabilities, the user's limits, the chosen streams and the
-- engine's capabilities; probe_hash covers the file.
CREATE TABLE playback_decision (
    probe_hash text NOT NULL,
    input_hash text NOT NULL,
    -- The PlaybackPlan, protobuf-encoded, without version id or URL.
    plan bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (probe_hash, input_hash)
);

-- +goose Down

DROP TABLE playback_decision;
ALTER TABLE user_account
    DROP COLUMN max_bitrate,
    DROP COLUMN preferred_subtitle_language,
    DROP COLUMN preferred_audio_language;
