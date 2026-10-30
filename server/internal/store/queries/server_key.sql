-- name: InsertServerKey :exec
INSERT INTO server_key (private_key) VALUES ($1) ON CONFLICT DO NOTHING;

-- name: GetServerKey :one
SELECT private_key FROM server_key;
