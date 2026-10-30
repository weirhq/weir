// Package access works out what a signed-in user may do in each library.
package access

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/store"
)

// Perms are what a user may do in one library.
type Perms struct {
	View, Play, Manage bool
}

// Normalize makes play and manage imply view.
func (p Perms) Normalize() Perms {
	p.View = p.View || p.Play || p.Manage
	return p
}

// Caller is the signed-in user and their access.
type Caller struct {
	UserID uuid.UUID
	Admin  bool
	perms  map[uuid.UUID]Perms
}

// Load reads the signed-in caller's role and library access.
func Load(ctx context.Context, st *store.Store) (*Caller, error) {
	claims := auth.ClaimsFrom(ctx)
	if claims == nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("not signed in"))
	}
	id, err := claims.UserID()
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid access token"))
	}
	return LoadUser(ctx, st, id)
}

// LoadUser reads a user's role and library access. Admins can do
// everything everywhere.
func LoadUser(ctx context.Context, st *store.Store, id uuid.UUID) (*Caller, error) {
	user, err := st.GetUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("account no longer exists"))
	}
	if err != nil {
		return nil, auth.Internal(ctx, "load user", err)
	}
	c := &Caller{UserID: id, Admin: user.Role == auth.RoleAdmin, perms: map[uuid.UUID]Perms{}}
	if c.Admin {
		return c, nil
	}
	rows, err := st.GetLibraryAccessRows(ctx, id)
	if err != nil {
		return nil, auth.Internal(ctx, "load library access", err)
	}
	for _, r := range rows {
		c.perms[r.LibraryID] = Perms{View: r.CanView, Play: r.CanPlay, Manage: r.CanManage}.Normalize()
	}
	return c, nil
}

// In returns the caller's permissions in a library.
func (c *Caller) In(library uuid.UUID) Perms {
	if c.Admin {
		return Perms{View: true, Play: true, Manage: true}
	}
	return c.perms[library]
}

// Visible filters libraries to those the caller may view.
func (c *Caller) Visible(libraries []uuid.UUID) []uuid.UUID {
	var out []uuid.UUID
	for _, id := range libraries {
		if c.In(id).View {
			out = append(out, id)
		}
	}
	return out
}

// ErrNotFound hides items in libraries the caller can't see, so their
// existence doesn't leak.
var ErrNotFound = connect.NewError(connect.CodeNotFound, errors.New("no such item"))
