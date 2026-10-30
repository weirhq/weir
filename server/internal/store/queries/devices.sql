-- name: CreateDevice :one
INSERT INTO device (
    id, user_id, name, client, client_version,
    refresh_token_hash, refresh_token_expires_at, authenticated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, now())
RETURNING *;

-- name: GetDeviceForUser :one
SELECT * FROM device WHERE id = $1 AND user_id = $2;

-- name: SignInDevice :one
UPDATE device
SET name = $2, client = $3, client_version = $4,
    refresh_token_hash = $5, refresh_token_expires_at = $6,
    authenticated_at = now(), last_seen_at = now()
WHERE id = $1
RETURNING *;

-- name: GetDeviceByRefreshToken :one
SELECT * FROM device
WHERE refresh_token_hash = $1 AND refresh_token_expires_at > now();

-- name: RotateRefreshToken :execrows
-- Matches on the old hash so two concurrent refreshes can't both succeed.
UPDATE device
SET refresh_token_hash = sqlc.arg(new_hash), refresh_token_expires_at = sqlc.arg(expires_at),
    last_seen_at = now()
WHERE id = sqlc.arg(id) AND refresh_token_hash = sqlc.arg(old_hash);

-- name: SignOutDevice :exec
UPDATE device
SET refresh_token_hash = NULL, refresh_token_expires_at = NULL
WHERE id = $1;

-- name: SignOutUser :exec
UPDATE device
SET refresh_token_hash = NULL, refresh_token_expires_at = NULL
WHERE user_id = $1;
