-- name: ItemVersions :many
SELECT v.id AS version_id, v.edition, f.id AS file_id, f.path, f.probe, f.probe_hash, f.duration_ms
FROM version v
JOIN media_file f ON f.version_id = v.id
WHERE v.item_id = $1
ORDER BY v.created_at;

-- name: GetPlaybackPreferences :one
SELECT preferred_audio_language, preferred_subtitle_language, max_bitrate FROM user_account WHERE id = $1;

-- name: GetPlaybackDecision :one
SELECT plan FROM playback_decision WHERE probe_hash = $1 AND input_hash = $2;

-- name: PutPlaybackDecision :exec
INSERT INTO playback_decision (probe_hash, input_hash, plan) VALUES ($1, $2, $3)
ON CONFLICT (probe_hash, input_hash) DO NOTHING;

-- name: GetMediaFilePath :one
SELECT path FROM media_file WHERE id = $1;
