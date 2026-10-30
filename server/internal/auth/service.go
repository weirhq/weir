package auth

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const (
	maxDeviceFieldLength = 128
	defaultDeviceName    = "Unknown device"
)

var errBadCredentials = connect.NewError(connect.CodeUnauthenticated, errors.New("wrong username or password"))

// Service implements weir.api.v1alpha.Auth.
type Service struct {
	store  *store.Store
	tokens *Tokens
	// Per IP for every sign-in call, and per username for Login.
	byIP   *limiter
	byUser *limiter
	// Verified against when a username doesn't exist, so a miss takes as long
	// as a wrong password.
	dummyHash string
}

func NewService(st *store.Store, tokens *Tokens) (*Service, error) {
	dummy, err := HashPassword("not a real password")
	if err != nil {
		return nil, err
	}
	return &Service{
		store:     st,
		tokens:    tokens,
		byIP:      newLimiter(20, 10),
		byUser:    newLimiter(5, 5),
		dummyHash: dummy,
	}, nil
}

var _ apiv1alpha.AuthHandler = (*Service)(nil)

func (s *Service) GetSetupState(ctx context.Context, _ *connect.Request[apiv1alpha.GetSetupStateRequest]) (*connect.Response[apiv1alpha.GetSetupStateResponse], error) {
	n, err := s.store.CountUsers(ctx)
	if err != nil {
		return nil, Internal(ctx, "count users", err)
	}
	return connect.NewResponse(&apiv1alpha.GetSetupStateResponse{NeedsBootstrap: n == 0}), nil
}

func (s *Service) Bootstrap(ctx context.Context, req *connect.Request[apiv1alpha.BootstrapRequest]) (*connect.Response[apiv1alpha.BootstrapResponse], error) {
	if err := s.limit(req.Peer()); err != nil {
		return nil, err
	}
	msg := req.Msg
	if err := errors.Join(ValidateUsername(msg.Username), ValidatePassword(msg.Password), ValidateDisplayName(msg.DisplayName)); err != nil {
		return nil, InvalidArgument(err)
	}
	hash, err := HashPassword(msg.Password)
	if err != nil {
		return nil, Internal(ctx, "hash password", err)
	}

	var creds *apiv1alpha.Credentials
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.LockAccounts(ctx); err != nil {
			return err
		}
		n, err := q.CountUsers(ctx)
		if err != nil {
			return err
		}
		if n > 0 {
			return connect.NewError(connect.CodeFailedPrecondition, errors.New("this server is already set up"))
		}
		user, err := q.CreateUser(ctx, dbgen.CreateUserParams{
			ID:           uuid.Must(uuid.NewV7()),
			Username:     msg.Username,
			DisplayName:  displayNameOr(msg.DisplayName, msg.Username),
			PasswordHash: hash,
			Role:         RoleAdmin,
		})
		if err != nil {
			return err
		}
		creds, err = s.signIn(ctx, q, user, msg.Device)
		return err
	})
	if err != nil {
		return nil, ConnectOrInternal(ctx, "bootstrap", err)
	}
	return connect.NewResponse(&apiv1alpha.BootstrapResponse{Credentials: creds}), nil
}

func (s *Service) Login(ctx context.Context, req *connect.Request[apiv1alpha.LoginRequest]) (*connect.Response[apiv1alpha.LoginResponse], error) {
	msg := req.Msg
	if err := s.limit(req.Peer(), "user:"+strings.ToLower(msg.Username)); err != nil {
		return nil, err
	}
	user, err := s.store.GetUserByUsername(ctx, msg.Username)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = VerifyPassword(msg.Password, s.dummyHash)
		return nil, errBadCredentials
	}
	if err != nil {
		return nil, Internal(ctx, "load user", err)
	}
	ok, err := VerifyPassword(msg.Password, user.PasswordHash)
	if err != nil {
		return nil, Internal(ctx, "verify password", err)
	}
	if !ok {
		return nil, errBadCredentials
	}

	var creds *apiv1alpha.Credentials
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		creds, err = s.signIn(ctx, q, user, msg.Device)
		return err
	})
	if err != nil {
		return nil, ConnectOrInternal(ctx, "sign in", err)
	}
	return connect.NewResponse(&apiv1alpha.LoginResponse{Credentials: creds}), nil
}

func (s *Service) Refresh(ctx context.Context, req *connect.Request[apiv1alpha.RefreshRequest]) (*connect.Response[apiv1alpha.RefreshResponse], error) {
	if err := s.limit(req.Peer()); err != nil {
		return nil, err
	}
	invalid := connect.NewError(connect.CodeUnauthenticated, errors.New("invalid or expired refresh token"))
	oldHash := HashRefreshToken(req.Msg.RefreshToken)
	device, err := s.store.GetDeviceByRefreshToken(ctx, oldHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, invalid
	}
	if err != nil {
		return nil, Internal(ctx, "load device", err)
	}

	refresh, newHash, err := NewRefreshToken()
	if err != nil {
		return nil, Internal(ctx, "refresh", err)
	}
	refreshExpires := time.Now().Add(RefreshTokenTTL)
	n, err := s.store.RotateRefreshToken(ctx, dbgen.RotateRefreshTokenParams{
		ID:        device.ID,
		OldHash:   oldHash,
		NewHash:   newHash,
		ExpiresAt: &refreshExpires,
	})
	if err != nil {
		return nil, Internal(ctx, "rotate refresh token", err)
	}
	if n == 0 {
		// Another refresh with the same token won the race.
		return nil, invalid
	}
	user, err := s.store.GetUser(ctx, device.UserID)
	if err != nil {
		return nil, Internal(ctx, "load user", err)
	}
	creds, err := s.credentials(user, device, refresh, refreshExpires)
	if err != nil {
		return nil, Internal(ctx, "issue access token", err)
	}
	return connect.NewResponse(&apiv1alpha.RefreshResponse{Credentials: creds}), nil
}

func (s *Service) Logout(ctx context.Context, _ *connect.Request[apiv1alpha.LogoutRequest]) (*connect.Response[apiv1alpha.LogoutResponse], error) {
	if err := s.store.SignOutDevice(ctx, ClaimsFrom(ctx).DeviceID); err != nil {
		return nil, Internal(ctx, "sign out", err)
	}
	return connect.NewResponse(&apiv1alpha.LogoutResponse{}), nil
}

func (s *Service) GetCurrentUser(ctx context.Context, _ *connect.Request[apiv1alpha.GetCurrentUserRequest]) (*connect.Response[apiv1alpha.GetCurrentUserResponse], error) {
	id, err := ClaimsFrom(ctx).UserID()
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid access token"))
	}
	user, err := s.store.GetUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("account no longer exists"))
	}
	if err != nil {
		return nil, Internal(ctx, "load user", err)
	}
	return connect.NewResponse(&apiv1alpha.GetCurrentUserResponse{User: UserToProto(user)}), nil
}

// signIn records a password sign-in on the client's device, reusing the
// device the client names if it belongs to this user.
func (s *Service) signIn(ctx context.Context, q *dbgen.Queries, user dbgen.UserAccount, info *apiv1alpha.DeviceInfo) (*apiv1alpha.Credentials, error) {
	name, client, version := deviceFields(info)
	refresh, hash, err := NewRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshExpires := time.Now().Add(RefreshTokenTTL)

	var device dbgen.Device
	existing, err := s.existingDevice(ctx, q, user.ID, info.GetDeviceId())
	if err != nil {
		return nil, err
	}
	if existing != uuid.Nil {
		device, err = q.SignInDevice(ctx, dbgen.SignInDeviceParams{
			ID:                    existing,
			Name:                  name,
			Client:                client,
			ClientVersion:         version,
			RefreshTokenHash:      hash,
			RefreshTokenExpiresAt: &refreshExpires,
		})
	} else {
		device, err = q.CreateDevice(ctx, dbgen.CreateDeviceParams{
			ID:                    uuid.Must(uuid.NewV7()),
			UserID:                user.ID,
			Name:                  name,
			Client:                client,
			ClientVersion:         version,
			RefreshTokenHash:      hash,
			RefreshTokenExpiresAt: &refreshExpires,
		})
	}
	if err != nil {
		return nil, err
	}
	return s.credentials(user, device, refresh, refreshExpires)
}

// existingDevice returns the id of the user's device named by deviceID, or
// uuid.Nil if there is none.
func (s *Service) existingDevice(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, deviceID string) (uuid.UUID, error) {
	id, err := uuid.Parse(deviceID)
	if err != nil {
		return uuid.Nil, nil
	}
	_, err = q.GetDeviceForUser(ctx, dbgen.GetDeviceForUserParams{ID: id, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil
	}
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func (s *Service) credentials(user dbgen.UserAccount, device dbgen.Device, refresh string, refreshExpires time.Time) (*apiv1alpha.Credentials, error) {
	access, accessExpires, err := s.tokens.Issue(user.ID, device.ID, user.Role, device.AuthenticatedAt)
	if err != nil {
		return nil, err
	}
	return &apiv1alpha.Credentials{
		AccessToken:           access,
		AccessTokenExpiresAt:  timestamppb.New(accessExpires),
		RefreshToken:          refresh,
		RefreshTokenExpiresAt: timestamppb.New(refreshExpires),
		DeviceId:              device.ID.String(),
		User:                  UserToProto(user),
	}, nil
}

// limit spends a token for the caller's IP and any extra keys.
func (s *Service) limit(peer connect.Peer, userKeys ...string) error {
	ip := peer.Addr
	if host, _, err := net.SplitHostPort(peer.Addr); err == nil {
		ip = host
	}
	ok := s.byIP.Allow("ip:" + ip)
	if len(userKeys) > 0 && !s.byUser.Allow(userKeys...) {
		ok = false
	}
	if !ok {
		return connect.NewError(connect.CodeResourceExhausted, errors.New("too many attempts; try again in a minute"))
	}
	return nil
}

func deviceFields(info *apiv1alpha.DeviceInfo) (name, client, version string) {
	name = truncate(info.GetName())
	if name == "" {
		name = defaultDeviceName
	}
	return name, truncate(info.GetClient()), truncate(info.GetClientVersion())
}

func truncate(s string) string {
	if utf8.RuneCountInString(s) <= maxDeviceFieldLength {
		return s
	}
	return string([]rune(s)[:maxDeviceFieldLength])
}

func displayNameOr(name, fallback string) string {
	if name == "" {
		return fallback
	}
	return name
}
