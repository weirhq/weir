package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"unicode/utf8"

	"connectrpc.com/connect"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// Role values as stored in user_account.role.
const (
	RoleAdmin  = "admin"
	RoleMember = "member"
)

const maxDisplayNameLength = 128

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func ValidateUsername(username string) error {
	if !usernamePattern.MatchString(username) {
		return errors.New("username must be 1 to 64 letters, digits, '.', '_' or '-'")
	}
	return nil
}

func ValidateDisplayName(name string) error {
	if utf8.RuneCountInString(name) > maxDisplayNameLength {
		return fmt.Errorf("display name must be at most %d characters", maxDisplayNameLength)
	}
	return nil
}

func UserToProto(u dbgen.UserAccount) *apiv1alpha.User {
	return &apiv1alpha.User{
		Id:          u.ID.String(),
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Role:        RoleToProto(u.Role),
	}
}

func RoleToProto(role string) apiv1alpha.Role {
	switch role {
	case RoleAdmin:
		return apiv1alpha.Role_ROLE_ADMIN
	case RoleMember:
		return apiv1alpha.Role_ROLE_MEMBER
	}
	return apiv1alpha.Role_ROLE_UNSPECIFIED
}

func RoleFromProto(role apiv1alpha.Role) (string, error) {
	switch role {
	case apiv1alpha.Role_ROLE_ADMIN:
		return RoleAdmin, nil
	case apiv1alpha.Role_ROLE_MEMBER:
		return RoleMember, nil
	}
	return "", errors.New("role must be admin or member")
}

// InvalidArgument wraps a validation error for the client.
func InvalidArgument(err error) error {
	return connect.NewError(connect.CodeInvalidArgument, err)
}

// Internal logs err and returns a generic error, so database details never
// reach the client.
func Internal(ctx context.Context, what string, err error) error {
	slog.ErrorContext(ctx, what, "err", err)
	return connect.NewError(connect.CodeInternal, errors.New("internal error"))
}

// ConnectOrInternal returns err unchanged if it is already a Connect error,
// and treats anything else as internal.
func ConnectOrInternal(ctx context.Context, what string, err error) error {
	var cerr *connect.Error
	if errors.As(err, &cerr) {
		return cerr
	}
	return Internal(ctx, what, err)
}
