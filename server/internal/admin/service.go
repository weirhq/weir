// Package admin implements weir.api.v1alpha.Admin.
package admin

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const uniqueViolation = "23505"

var (
	errUserNotFound = connect.NewError(connect.CodeNotFound, errors.New("no such user"))
	errLastAdmin    = connect.NewError(connect.CodeFailedPrecondition, errors.New("the server needs at least one admin"))
)

type Service struct {
	store *store.Store
	// The server's library_paths: every library folder must be inside one.
	roots []string
	jobs  library.Inserter
}

func NewService(st *store.Store, roots []string, jobs library.Inserter) *Service {
	return &Service{store: st, roots: roots, jobs: jobs}
}

var _ apiv1alpha.AdminHandler = (*Service)(nil)

func (s *Service) ListUsers(ctx context.Context, _ *connect.Request[apiv1alpha.ListUsersRequest]) (*connect.Response[apiv1alpha.ListUsersResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return nil, auth.Internal(ctx, "list users", err)
	}
	resp := &apiv1alpha.ListUsersResponse{}
	for _, u := range users {
		resp.Users = append(resp.Users, auth.UserToProto(u))
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) CreateUser(ctx context.Context, req *connect.Request[apiv1alpha.CreateUserRequest]) (*connect.Response[apiv1alpha.CreateUserResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	msg := req.Msg
	role, roleErr := auth.RoleFromProto(msg.Role)
	if err := errors.Join(auth.ValidateUsername(msg.Username), auth.ValidatePassword(msg.Password), auth.ValidateDisplayName(msg.DisplayName), roleErr); err != nil {
		return nil, auth.InvalidArgument(err)
	}
	hash, err := auth.HashPassword(msg.Password)
	if err != nil {
		return nil, auth.Internal(ctx, "hash password", err)
	}
	displayName := msg.DisplayName
	if displayName == "" {
		displayName = msg.Username
	}
	user, err := s.store.CreateUser(ctx, dbgen.CreateUserParams{
		ID:           uuid.Must(uuid.NewV7()),
		Username:     msg.Username,
		DisplayName:  displayName,
		PasswordHash: hash,
		Role:         role,
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("username %q is taken", msg.Username))
	}
	if err != nil {
		return nil, auth.Internal(ctx, "create user", err)
	}
	return connect.NewResponse(&apiv1alpha.CreateUserResponse{User: auth.UserToProto(user)}), nil
}

func (s *Service) UpdateUser(ctx context.Context, req *connect.Request[apiv1alpha.UpdateUserRequest]) (*connect.Response[apiv1alpha.UpdateUserResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	msg := req.Msg
	id, err := uuid.Parse(msg.Id)
	if err != nil {
		return nil, errUserNotFound
	}
	paths := msg.GetUpdateMask().GetPaths()
	if len(paths) == 0 {
		return nil, auth.InvalidArgument(errors.New("update_mask names no fields"))
	}

	var role, hash string
	var setName, setRole, setPassword bool
	for _, p := range paths {
		switch p {
		case "display_name":
			setName = true
			if err := auth.ValidateDisplayName(msg.DisplayName); err != nil {
				return nil, auth.InvalidArgument(err)
			}
		case "role":
			setRole = true
			if role, err = auth.RoleFromProto(msg.Role); err != nil {
				return nil, auth.InvalidArgument(err)
			}
		case "password":
			setPassword = true
			if err := auth.ValidatePassword(msg.Password); err != nil {
				return nil, auth.InvalidArgument(err)
			}
			if hash, err = auth.HashPassword(msg.Password); err != nil {
				return nil, auth.Internal(ctx, "hash password", err)
			}
		default:
			return nil, auth.InvalidArgument(fmt.Errorf("update_mask: unknown field %q", p))
		}
	}

	var updated dbgen.UserAccount
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.LockAccounts(ctx); err != nil {
			return err
		}
		user, err := q.GetUser(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errUserNotFound
		}
		if err != nil {
			return err
		}
		params := dbgen.UpdateUserParams{ID: id, DisplayName: user.DisplayName, Role: user.Role, PasswordHash: user.PasswordHash}
		if setName {
			params.DisplayName = msg.DisplayName
			if params.DisplayName == "" {
				params.DisplayName = user.Username
			}
		}
		if setRole {
			if user.Role == auth.RoleAdmin && role != auth.RoleAdmin {
				if err := requireAnotherAdmin(ctx, q); err != nil {
					return err
				}
			}
			params.Role = role
		}
		if setPassword {
			params.PasswordHash = hash
			if err := q.SignOutUser(ctx, id); err != nil {
				return err
			}
		}
		updated, err = q.UpdateUser(ctx, params)
		return err
	})
	if err != nil {
		return nil, auth.ConnectOrInternal(ctx, "update user", err)
	}
	return connect.NewResponse(&apiv1alpha.UpdateUserResponse{User: auth.UserToProto(updated)}), nil
}

func (s *Service) DeleteUser(ctx context.Context, req *connect.Request[apiv1alpha.DeleteUserRequest]) (*connect.Response[apiv1alpha.DeleteUserResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, errUserNotFound
	}
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.LockAccounts(ctx); err != nil {
			return err
		}
		user, err := q.GetUser(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errUserNotFound
		}
		if err != nil {
			return err
		}
		if user.Role == auth.RoleAdmin {
			if err := requireAnotherAdmin(ctx, q); err != nil {
				return err
			}
		}
		// Devices go with the user (ON DELETE CASCADE).
		_, err = q.DeleteUser(ctx, id)
		return err
	})
	if err != nil {
		return nil, auth.ConnectOrInternal(ctx, "delete user", err)
	}
	return connect.NewResponse(&apiv1alpha.DeleteUserResponse{}), nil
}

// requireAnotherAdmin fails if removing one admin would leave none. Call it
// with the accounts lock held.
func requireAnotherAdmin(ctx context.Context, q *dbgen.Queries) error {
	n, err := q.CountAdmins(ctx)
	if err != nil {
		return err
	}
	if n <= 1 {
		return errLastAdmin
	}
	return nil
}
