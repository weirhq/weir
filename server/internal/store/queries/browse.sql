-- name: GetLibraryAccessRows :many
SELECT * FROM library_access WHERE user_id = $1 ORDER BY library_id;

-- name: ClearLibraryAccess :exec
DELETE FROM library_access WHERE user_id = $1;

-- name: AddLibraryAccess :exec
INSERT INTO library_access (user_id, library_id, can_view, can_play, can_manage) VALUES ($1, $2, $3, $4, $5);

-- name: ListItems :many
-- One page of a library's top level or an item's children. The sort is one
-- of title, year, added or index.
SELECT i.id, i.kind, r.title, r.year, i.index_number, i.disc_number, i.library_id, i.parent_id,
       count(*) OVER () AS total
FROM item i
JOIN resolved_metadata r ON r.item_id = i.id
WHERE (sqlc.narg(library_id)::uuid IS NULL OR (i.library_id = sqlc.narg(library_id)::uuid AND i.parent_id IS NULL))
  AND (sqlc.narg(parent_id)::uuid IS NULL OR i.parent_id = sqlc.narg(parent_id)::uuid)
  AND (cardinality(sqlc.arg(kinds)::text[]) = 0 OR i.kind = ANY(sqlc.arg(kinds)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort)::text = 'year' THEN r.year END DESC,
  CASE WHEN sqlc.arg(sort)::text = 'added' THEN i.created_at END DESC,
  CASE WHEN sqlc.arg(sort)::text = 'index' THEN coalesce(i.disc_number, 0) END,
  CASE WHEN sqlc.arg(sort)::text = 'index' THEN i.index_number END NULLS LAST,
  i.sort_title, i.id
LIMIT sqlc.arg(page_size)::int OFFSET sqlc.arg(page_offset)::int;

-- name: ItemAncestors :many
-- An item's ancestors, top first.
WITH RECURSIVE up AS (
    SELECT p.*, 1 AS depth FROM item p WHERE p.id = (SELECT c.parent_id FROM item c WHERE c.id = $1)
    UNION ALL
    SELECT p.*, up.depth + 1 FROM item p JOIN up ON p.id = up.parent_id
)
SELECT up.id, up.kind, r.title, r.year, up.index_number, up.disc_number, up.library_id, up.parent_id
FROM up JOIN resolved_metadata r ON r.item_id = up.id
ORDER BY up.depth DESC;

-- name: VersionDetails :many
SELECT v.id AS version_id, v.edition, f.id AS file_id, f.container, f.duration_ms, f.size_bytes
FROM version v JOIN media_file f ON f.version_id = v.id
WHERE v.item_id = $1
ORDER BY v.created_at;

-- name: StreamsForFiles :many
SELECT * FROM stream WHERE media_file_id = ANY(sqlc.arg(file_ids)::uuid[]) ORDER BY media_file_id, index;

-- name: SearchItems :many
-- Typo-tolerant title matches and full-text matches on overviews and cast,
-- best first, within the given libraries.
SELECT i.id, i.kind, r.title, r.year, i.index_number, i.disc_number, i.library_id, i.parent_id,
       greatest(
           similarity(i.title, sqlc.arg(query)::text),
           coalesce((
               SELECT max(ts_rank(to_tsvector('simple', coalesce(m.title, '') || ' ' || coalesce(m.original_title, '') || ' '
                          || coalesce(m.overview, '') || ' ' || m.cast_members::text),
                      websearch_to_tsquery('simple', sqlc.arg(query)::text)))
               FROM metadata m WHERE m.item_id = i.id
           ), 0)
       )::real AS score
FROM item i
JOIN resolved_metadata r ON r.item_id = i.id
WHERE i.library_id = ANY(sqlc.arg(library_ids)::uuid[])
  AND i.kind IN ('movie', 'show', 'episode', 'artist', 'album', 'track')
  AND (
      i.title % sqlc.arg(query)::text
      OR i.title ILIKE '%' || sqlc.arg(query)::text || '%'
      OR EXISTS (
          SELECT 1 FROM metadata m WHERE m.item_id = i.id
            AND to_tsvector('simple', coalesce(m.title, '') || ' ' || coalesce(m.original_title, '') || ' '
                || coalesce(m.overview, '') || ' ' || m.cast_members::text)
                @@ websearch_to_tsquery('simple', sqlc.arg(query)::text)
      )
  )
ORDER BY score DESC, i.sort_title
LIMIT sqlc.arg(max_results)::int;
