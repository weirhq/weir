-- name: ItemsNeedingMetadata :many
-- Top-level items never looked up, or not for a month. Seasons, episodes and
-- tracks are filled in with their show or album.
SELECT i.id, i.kind, i.title, i.year, i.parent_id
FROM item i
WHERE i.library_id = $1
  AND i.kind IN ('movie', 'show', 'artist', 'album')
  AND NOT EXISTS (
      SELECT 1 FROM metadata m WHERE m.item_id = i.id AND m.fetched_at > now() - interval '30 days'
  )
  AND NOT EXISTS (
      SELECT 1 FROM metadata_attempt a WHERE a.item_id = i.id AND a.attempted_at > now() - interval '30 days'
  )
ORDER BY i.kind, i.sort_title;

-- name: RecordMetadataAttempt :exec
INSERT INTO metadata_attempt (item_id) VALUES ($1)
ON CONFLICT (item_id) DO UPDATE SET attempted_at = now();

-- name: ItemFilePaths :many
-- Every file under an item, at any depth: a show's episodes, an album's
-- tracks.
WITH RECURSIVE tree AS (
    SELECT item.id FROM item WHERE item.id = $1
    UNION ALL
    SELECT c.id FROM item c JOIN tree t ON c.parent_id = t.id
)
SELECT f.path, f.probe
FROM tree
JOIN version v ON v.item_id = tree.id
JOIN media_file f ON f.version_id = v.id
ORDER BY f.path;

-- name: ChildItems :many
SELECT id, kind, title, index_number, disc_number FROM item WHERE parent_id = sqlc.arg(parent_id)::uuid ORDER BY sort_title;

-- name: GetItem :one
SELECT * FROM item WHERE id = $1;

-- name: UpsertMetadata :exec
INSERT INTO metadata (
    item_id, source, title, original_title, overview, tagline, year, release_date,
    runtime_minutes, rating, content_rating, genres, cast_members, external_ids
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (item_id, source) DO UPDATE SET
    title = EXCLUDED.title, original_title = EXCLUDED.original_title,
    overview = EXCLUDED.overview, tagline = EXCLUDED.tagline, year = EXCLUDED.year,
    release_date = EXCLUDED.release_date, runtime_minutes = EXCLUDED.runtime_minutes,
    rating = EXCLUDED.rating, content_rating = EXCLUDED.content_rating,
    genres = EXCLUDED.genres, cast_members = EXCLUDED.cast_members,
    external_ids = EXCLUDED.external_ids, fetched_at = now();

-- name: UpsertArtwork :exec
-- A new location clears the cached copy's details.
INSERT INTO artwork (item_id, kind, source, location) VALUES ($1, $2, $3, $4)
ON CONFLICT (item_id, kind, source) DO UPDATE SET
    location = EXCLUDED.location,
    hash = CASE WHEN artwork.location = EXCLUDED.location THEN artwork.hash END,
    width = CASE WHEN artwork.location = EXCLUDED.location THEN artwork.width END,
    height = CASE WHEN artwork.location = EXCLUDED.location THEN artwork.height END;

-- name: GetResolvedMetadata :one
SELECT * FROM resolved_metadata WHERE item_id = $1;
