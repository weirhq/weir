package admin

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/access"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const foreignKeyViolation = "23503"

func (s *Service) GetLibraryAccess(ctx context.Context, req *connect.Request[apiv1alpha.GetLibraryAccessRequest]) (*connect.Response[apiv1alpha.GetLibraryAccessResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	id, err := s.existingUser(ctx, req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	rows, err := s.store.GetLibraryAccessRows(ctx, id)
	if err != nil {
		return nil, auth.Internal(ctx, "load library access", err)
	}
	resp := &apiv1alpha.GetLibraryAccessResponse{}
	for _, r := range rows {
		resp.Access = append(resp.Access, &apiv1alpha.LibraryAccess{LibraryId: r.LibraryID.String(), View: r.CanView, Play: r.CanPlay, Manage: r.CanManage})
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) SetLibraryAccess(ctx context.Context, req *connect.Request[apiv1alpha.SetLibraryAccessRequest]) (*connect.Response[apiv1alpha.SetLibraryAccessResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	id, err := s.existingUser(ctx, req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	type grant struct {
		library uuid.UUID
		perms   access.Perms
	}
	var grants []grant
	seen := map[uuid.UUID]bool{}
	for _, a := range req.Msg.Access {
		lib, err := uuid.Parse(a.LibraryId)
		if err != nil || seen[lib] {
			return nil, auth.InvalidArgument(errors.New("each library_id must be a library, once"))
		}
		seen[lib] = true
		p := access.Perms{View: a.View, Play: a.Play, Manage: a.Manage}.Normalize()
		if p.View {
			grants = append(grants, grant{lib, p})
		}
	}
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.ClearLibraryAccess(ctx, id); err != nil {
			return err
		}
		for _, g := range grants {
			if err := q.AddLibraryAccess(ctx, dbgen.AddLibraryAccessParams{
				UserID: id, LibraryID: g.library, CanView: g.perms.View, CanPlay: g.perms.Play, CanManage: g.perms.Manage,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == foreignKeyViolation {
		return nil, auth.InvalidArgument(errors.New("no such library"))
	}
	if err != nil {
		return nil, auth.Internal(ctx, "set library access", err)
	}
	return connect.NewResponse(&apiv1alpha.SetLibraryAccessResponse{}), nil
}

func (s *Service) existingUser(ctx context.Context, id string) (uuid.UUID, error) {
	userID, err := uuid.Parse(id)
	if err != nil {
		return uuid.Nil, errUserNotFound
	}
	if _, err := s.store.GetUser(ctx, userID); errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, errUserNotFound
	} else if err != nil {
		return uuid.Nil, auth.Internal(ctx, "load user", err)
	}
	return userID, nil
}
