-- name: GetMediaFileByPath :one
SELECT id, version_id, size_bytes, modified_at FROM media_file WHERE path = $1;

-- name: ListMediaFiles :many
SELECT id, path FROM media_file WHERE library_id = $1;

-- name: InsertMediaFile :exec
INSERT INTO media_file (
    id, library_id, version_id, path, size_bytes, modified_at,
    container, duration_ms, probe_hash, probe
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: DeleteMediaFile :exec
-- Its version goes too: a version exists only to hold its file.
WITH gone AS (DELETE FROM media_file m WHERE m.id = sqlc.arg(id) RETURNING m.version_id)
DELETE FROM version v WHERE v.id = (SELECT gone.version_id FROM gone);

-- name: InsertStreams :copyfrom
INSERT INTO stream (
    media_file_id, index, kind, codec, profile, language, title,
    is_default, is_forced, hdr_format, width, height, channels
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);

-- name: UpsertItem :one
-- Finds the item the matcher means, creating it if needed. Titles and years
-- from the newest file win.
INSERT INTO item (
    id, library_id, kind, parent_id, title, sort_title, year,
    index_number, disc_number, match_key
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (library_id, kind, parent_id, match_key) DO UPDATE
SET title = EXCLUDED.title, sort_title = EXCLUDED.sort_title,
    year = COALESCE(EXCLUDED.year, item.year), updated_at = now()
RETURNING id;

-- name: CreateVersion :exec
INSERT INTO version (id, item_id, edition) VALUES ($1, $2, $3);

-- name: PruneEmptyItems :execrows
-- Items left with no versions and no children. Run until it deletes nothing:
-- each pass can empty a parent.
DELETE FROM item i
WHERE i.library_id = $1
  AND NOT EXISTS (SELECT 1 FROM version v WHERE v.item_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM item c WHERE c.parent_id = i.id);
