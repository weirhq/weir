-- name: ListPlaylists :many
-- The user's playlists and everyone's shared ones, with how many of their
-- items sit in the given libraries.
SELECT p.id, p.name, p.shared, p.owner_id, u.display_name AS owner_name,
       (SELECT count(*) FROM playlist_item pi JOIN item i ON i.id = pi.item_id
        WHERE pi.playlist_id = p.id AND i.library_id = ANY(sqlc.arg(library_ids)::uuid[]))::int AS item_count
FROM playlist p JOIN user_account u ON u.id = p.owner_id
WHERE p.owner_id = sqlc.arg(user_id) OR p.shared
ORDER BY lower(p.name), p.id;

-- name: GetPlaylist :one
SELECT p.id, p.name, p.shared, p.owner_id, u.display_name AS owner_name
FROM playlist p JOIN user_account u ON u.id = p.owner_id
WHERE p.id = $1;

-- name: PlaylistItems :many
SELECT i.id, i.kind, r.title, r.year, i.index_number, i.disc_number, i.library_id, i.parent_id,
       ps.position_ms, ps.watched, ps.play_count, ps.last_played,
       coalesce((SELECT array_agg(DISTINCT a.kind) FROM artwork a WHERE a.item_id = i.id), '{}')::text[] AS art_kinds
FROM playlist_item pi
JOIN item i ON i.id = pi.item_id
JOIN resolved_metadata r ON r.item_id = i.id
LEFT JOIN playback_state ps ON ps.item_id = i.id AND ps.user_id = sqlc.arg(user_id)
WHERE pi.playlist_id = sqlc.arg(playlist_id) AND i.library_id = ANY(sqlc.arg(library_ids)::uuid[])
ORDER BY pi.position;

-- name: CreatePlaylist :exec
INSERT INTO playlist (id, owner_id, name, shared) VALUES ($1, $2, $3, $4);

-- name: UpdatePlaylist :exec
UPDATE playlist SET name = $2, shared = $3, updated_at = now() WHERE id = $1;

-- name: DeletePlaylist :exec
DELETE FROM playlist WHERE id = $1;

-- name: ClearPlaylistItems :exec
DELETE FROM playlist_item WHERE playlist_id = $1;

-- name: AddPlaylistItem :exec
INSERT INTO playlist_item (playlist_id, position, item_id) VALUES ($1, $2, $3);

-- name: ItemsByID :many
SELECT id, kind, library_id FROM item WHERE id = ANY(sqlc.arg(ids)::uuid[]);
