-- name: GetPlaybackState :one
SELECT * FROM playback_state WHERE user_id = $1 AND item_id = $2;

-- name: PutPlaybackState :exec
INSERT INTO playback_state (user_id, item_id, position_ms, watched, play_count, last_played, counted)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (user_id, item_id) DO UPDATE SET
    position_ms = EXCLUDED.position_ms, watched = EXCLUDED.watched, play_count = EXCLUDED.play_count,
    last_played = EXCLUDED.last_played, counted = EXCLUDED.counted;

-- name: ItemDurationMs :one
-- The longest version's runtime; zero when unknown.
SELECT coalesce(max(f.duration_ms), 0)::bigint
FROM version v JOIN media_file f ON f.version_id = v.id
WHERE v.item_id = $1;

-- name: SetWatchedTree :exec
-- Marks every playable item at or under the given one.
WITH RECURSIVE tree AS (
    SELECT item.id FROM item WHERE item.id = sqlc.arg(item_id)
    UNION ALL
    SELECT c.id FROM item c JOIN tree t ON c.parent_id = t.id
),
playable AS (
    SELECT DISTINCT tree.id FROM tree JOIN version v ON v.item_id = tree.id
)
INSERT INTO playback_state (user_id, item_id, position_ms, watched, play_count, last_played, counted)
SELECT sqlc.arg(user_id), playable.id, 0, sqlc.arg(watched)::boolean,
       CASE WHEN sqlc.arg(watched)::boolean THEN 1 ELSE 0 END, now(), false
FROM playable
ON CONFLICT (user_id, item_id) DO UPDATE SET
    watched = EXCLUDED.watched,
    position_ms = 0,
    play_count = CASE WHEN EXCLUDED.watched THEN greatest(playback_state.play_count, 1) ELSE playback_state.play_count END;

-- name: ContinueWatching :many
SELECT i.id, i.kind, r.title, r.year, i.index_number, i.disc_number, i.library_id, i.parent_id,
       ps.position_ms, ps.watched, ps.play_count, ps.last_played,
       coalesce((SELECT array_agg(DISTINCT a.kind) FROM artwork a WHERE a.item_id = i.id), '{}')::text[] AS art_kinds
FROM playback_state ps
JOIN item i ON i.id = ps.item_id
JOIN resolved_metadata r ON r.item_id = i.id
WHERE ps.user_id = sqlc.arg(user_id) AND NOT ps.watched AND ps.position_ms > 0
  AND i.kind IN ('movie', 'episode') AND i.library_id = ANY(sqlc.arg(library_ids)::uuid[])
ORDER BY ps.last_played DESC
LIMIT sqlc.arg(max_results)::int;

-- name: RecentlyAdded :many
SELECT i.id, i.kind, r.title, r.year, i.index_number, i.disc_number, i.library_id, i.parent_id,
       ps.position_ms, ps.watched, ps.play_count, ps.last_played,
       coalesce((SELECT array_agg(DISTINCT a.kind) FROM artwork a WHERE a.item_id = i.id), '{}')::text[] AS art_kinds
FROM item i
JOIN resolved_metadata r ON r.item_id = i.id
LEFT JOIN playback_state ps ON ps.item_id = i.id AND ps.user_id = sqlc.arg(user_id)
WHERE i.kind = ANY(sqlc.arg(kinds)::text[]) AND i.library_id = ANY(sqlc.arg(library_ids)::uuid[])
ORDER BY i.created_at DESC, i.id
LIMIT sqlc.arg(max_results)::int;

-- name: ItemUserView :one
-- The caller's state and the artwork kinds of one item.
SELECT ps.position_ms, ps.watched, ps.play_count, ps.last_played,
       coalesce((SELECT array_agg(DISTINCT a.kind) FROM artwork a WHERE a.item_id = sqlc.arg(item_id)), '{}')::text[] AS art_kinds
FROM (SELECT 1) one
LEFT JOIN playback_state ps ON ps.item_id = sqlc.arg(item_id) AND ps.user_id = sqlc.arg(user_id);

-- name: ArtworkCandidates :many
-- Every source's picture of one kind for an item, best first.
SELECT * FROM artwork WHERE item_id = $1 AND kind = $2 ORDER BY artwork_priority(source);

-- name: SetArtworkCache :exec
UPDATE artwork SET hash = $4, width = $5, height = $6 WHERE item_id = $1 AND kind = $2 AND source = $3;
