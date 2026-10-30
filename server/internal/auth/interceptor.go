package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// AdminReauthWindow is how recently an admin must have entered their
// password to make admin calls.
const AdminReauthWindow = 10 * time.Minute

// ErrReauthRequired is the message clients match to prompt for a password.
const ErrReauthRequired = "sign in again to continue"

// publicProcedures need no access token.
var publicProcedures = map[string]bool{
	apiv1alpha.AuthGetSetupStateProcedure: true,
	apiv1alpha.AuthBootstrapProcedure:     true,
	apiv1alpha.AuthLoginProcedure:         true,
	apiv1alpha.AuthRefreshProcedure:       true,
}

type claimsKey struct{}

// ClaimsFrom returns the caller's verified claims. Every non-public
// procedure has them.
func ClaimsFrom(ctx context.Context) *Claims {
	c, _ := ctx.Value(claimsKey{}).(*Claims)
	return c
}

// NewInterceptor rejects calls to non-public procedures without a valid
// bearer token.
func NewInterceptor(tokens *Tokens) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if publicProcedures[req.Spec().Procedure] {
				return next(ctx, req)
			}
			token, ok := strings.CutPrefix(req.Header().Get("Authorization"), "Bearer ")
			if !ok {
				return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("missing bearer token"))
			}
			claims, err := tokens.Parse(token)
			if err != nil {
				return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid or expired access token"))
			}
			return next(context.WithValue(ctx, claimsKey{}, claims), req)
		}
	}
}

// RequireAdmin returns the calling user if they are an admin who entered
// their password within AdminReauthWindow. The role is read from the
// database, so a demotion applies immediately.
func RequireAdmin(ctx context.Context, st *store.Store) (dbgen.UserAccount, error) {
	claims := ClaimsFrom(ctx)
	if claims == nil {
		return dbgen.UserAccount{}, connect.NewError(connect.CodeUnauthenticated, errors.New("not signed in"))
	}
	id, err := claims.UserID()
	if err != nil {
		return dbgen.UserAccount{}, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid access token"))
	}
	user, err := st.GetUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return dbgen.UserAccount{}, connect.NewError(connect.CodeUnauthenticated, errors.New("account no longer exists"))
	}
	if err != nil {
		return dbgen.UserAccount{}, Internal(ctx, "load user", err)
	}
	if user.Role != RoleAdmin {
		return dbgen.UserAccount{}, connect.NewError(connect.CodePermissionDenied, errors.New("admin role required"))
	}
	if time.Since(claims.AuthenticatedAt()) > AdminReauthWindow {
		return dbgen.UserAccount{}, connect.NewError(connect.CodePermissionDenied, errors.New(ErrReauthRequired))
	}
	return user, nil
}
