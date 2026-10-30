-- name: CountUsers :one
SELECT count(*) FROM user_account;

-- name: CountAdmins :one
SELECT count(*) FROM user_account WHERE role = 'admin';

-- name: CreateUser :one
INSERT INTO user_account (id, username, display_name, password_hash, role)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUser :one
SELECT * FROM user_account WHERE id = $1;

-- name: GetUserByUsername :one
SELECT * FROM user_account WHERE lower(username) = lower(sqlc.arg(username));

-- name: ListUsers :many
SELECT * FROM user_account ORDER BY lower(username);

-- name: UpdateUser :one
UPDATE user_account
SET display_name = $2, role = $3, password_hash = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteUser :execrows
DELETE FROM user_account WHERE id = $1;

-- name: LockAccounts :exec
-- Serialises bootstrap and last-admin checks across connections.
SELECT pg_advisory_xact_lock(hashtext('weir.user_account'));
