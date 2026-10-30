-- name: CreateLibrary :one
INSERT INTO library (id, name, kind) VALUES ($1, $2, $3) RETURNING *;

-- name: GetLibrary :one
SELECT * FROM library WHERE id = $1;

-- name: ListLibraries :many
SELECT * FROM library ORDER BY lower(name);

-- name: RenameLibrary :one
UPDATE library SET name = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteLibrary :execrows
DELETE FROM library WHERE id = $1;

-- name: ListLibraryPaths :many
SELECT * FROM library_path WHERE library_id = ANY(sqlc.arg(library_ids)::uuid[]) ORDER BY path;

-- name: AddLibraryPath :exec
INSERT INTO library_path (library_id, path) VALUES ($1, $2);

-- name: ClearLibraryPaths :exec
DELETE FROM library_path WHERE library_id = $1;

-- name: ListAllLibraryPaths :many
SELECT * FROM library_path ORDER BY path;
