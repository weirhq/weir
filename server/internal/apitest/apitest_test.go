// Package apitest exercises the Auth and Admin services end to end: real
// HTTP, real interceptors, real Postgres.
package apitest

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/admin"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/browse"
	"github.com/weirhq/weir/server/internal/jobs"
	mediaurl "github.com/weirhq/weir/server/internal/media"
	"github.com/weirhq/weir/server/internal/playback"
	"github.com/weirhq/weir/server/internal/playback/playbacktest"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/storetest"
)

type harness struct {
	store *store.Store
	auth  apiv1alpha.AuthClient
	url   string
	// What the fake engine has reported.
	engineCaps *enginev1alpha.CapabilitiesResponse
	// The server's library_paths root, for library tests.
	media string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	st := storetest.New(t)
	ctx := context.Background()
	key, err := auth.LoadServerKey(ctx, st)
	if err != nil {
		t.Fatal(err)
	}
	tokens := auth.NewTokens(key, "http://weir.test")
	authService, err := auth.NewService(st, tokens)
	if err != nil {
		t.Fatal(err)
	}
	if err := jobs.Migrate(ctx, st.Pool); err != nil {
		t.Fatal(err)
	}
	jobClient, err := jobs.NewClient(st.Pool, nil)
	if err != nil {
		t.Fatal(err)
	}
	media := t.TempDir()
	interceptors := connect.WithInterceptors(auth.NewInterceptor(tokens))
	mux := http.NewServeMux()
	mux.Handle(apiv1alpha.NewAuthHandler(authService, interceptors))
	mux.Handle(apiv1alpha.NewAdminHandler(admin.NewService(st, []string{media}, jobClient), interceptors))
	h := &harness{store: st, media: media}
	signer := mediaurl.NewSigner(key)
	sessions := playback.NewSessions((&playbacktest.Engine{}).Client(t), t.TempDir(), signer)
	mux.Handle(apiv1alpha.NewBrowseHandler(browse.NewService(st), interceptors))
	mux.Handle(apiv1alpha.NewPlaybackHandler(playback.NewService(st, signer, sessions, func() *enginev1alpha.CapabilitiesResponse { return h.engineCaps }), interceptors))
	mux.Handle(mediaurl.FilePrefix, mediaurl.Handler(signer, st))
	mux.Handle(playback.SessionPrefix, sessions.Handler())
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	h.auth, h.url = apiv1alpha.NewAuthClient(srv.Client(), srv.URL), srv.URL
	return h
}

// bearer returns client options that send creds' access token.
func bearer(creds *apiv1alpha.Credentials) connect.ClientOption {
	return connect.WithInterceptors(connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			req.Header().Set("Authorization", "Bearer "+creds.AccessToken)
			return next(ctx, req)
		}
	}))
}

func (h *harness) adminClient(creds *apiv1alpha.Credentials) apiv1alpha.AdminClient {
	return apiv1alpha.NewAdminClient(http.DefaultClient, h.url, bearer(creds))
}

func (h *harness) authClient(creds *apiv1alpha.Credentials) apiv1alpha.AuthClient {
	return apiv1alpha.NewAuthClient(http.DefaultClient, h.url, bearer(creds))
}

func (h *harness) bootstrap(t *testing.T) *apiv1alpha.Credentials {
	t.Helper()
	resp, err := h.auth.Bootstrap(context.Background(), connect.NewRequest(&apiv1alpha.BootstrapRequest{
		Username: "luna",
		Password: "first admin password",
		Device:   &apiv1alpha.DeviceInfo{Name: "Test", Client: "apitest", ClientVersion: "0"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	return resp.Msg.Credentials
}

func (h *harness) login(t *testing.T, username, password string) *apiv1alpha.Credentials {
	t.Helper()
	resp, err := h.auth.Login(context.Background(), connect.NewRequest(&apiv1alpha.LoginRequest{Username: username, Password: password}))
	if err != nil {
		t.Fatalf("login as %s: %v", username, err)
	}
	return resp.Msg.Credentials
}

func wantCode(t *testing.T, err error, code connect.Code) {
	t.Helper()
	if got := connect.CodeOf(err); got != code {
		t.Fatalf("got %v (%v), want %v", got, err, code)
	}
}

func TestBootstrapOnlyOnce(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	state, err := h.auth.GetSetupState(ctx, connect.NewRequest(&apiv1alpha.GetSetupStateRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if !state.Msg.NeedsBootstrap {
		t.Fatal("fresh server does not need bootstrap")
	}

	creds := h.bootstrap(t)
	if creds.User.Role != apiv1alpha.Role_ROLE_ADMIN || creds.User.DisplayName != "luna" {
		t.Errorf("unexpected bootstrap user: %v", creds.User)
	}

	state, _ = h.auth.GetSetupState(ctx, connect.NewRequest(&apiv1alpha.GetSetupStateRequest{}))
	if state.Msg.NeedsBootstrap {
		t.Error("still needs bootstrap after bootstrapping")
	}
	_, err = h.auth.Bootstrap(ctx, connect.NewRequest(&apiv1alpha.BootstrapRequest{Username: "mallory", Password: "second admin password"}))
	wantCode(t, err, connect.CodeFailedPrecondition)
}

func TestLoginRefreshLogout(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	h.bootstrap(t)

	_, err := h.auth.Login(ctx, connect.NewRequest(&apiv1alpha.LoginRequest{Username: "luna", Password: "wrong password"}))
	wantCode(t, err, connect.CodeUnauthenticated)
	_, err = h.auth.Login(ctx, connect.NewRequest(&apiv1alpha.LoginRequest{Username: "nobody", Password: "whatever123"}))
	wantCode(t, err, connect.CodeUnauthenticated)

	creds := h.login(t, "LUNA", "first admin password")
	me, err := h.authClient(creds).GetCurrentUser(ctx, connect.NewRequest(&apiv1alpha.GetCurrentUserRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if me.Msg.User.Username != "luna" {
		t.Errorf("current user = %v", me.Msg.User)
	}

	refreshed, err := h.auth.Refresh(ctx, connect.NewRequest(&apiv1alpha.RefreshRequest{RefreshToken: creds.RefreshToken}))
	if err != nil {
		t.Fatal(err)
	}
	next := refreshed.Msg.Credentials
	if next.RefreshToken == creds.RefreshToken || next.DeviceId != creds.DeviceId {
		t.Errorf("refresh did not rotate on the same device: %v", next)
	}
	_, err = h.auth.Refresh(ctx, connect.NewRequest(&apiv1alpha.RefreshRequest{RefreshToken: creds.RefreshToken}))
	wantCode(t, err, connect.CodeUnauthenticated)

	if _, err := h.authClient(next).Logout(ctx, connect.NewRequest(&apiv1alpha.LogoutRequest{})); err != nil {
		t.Fatal(err)
	}
	_, err = h.auth.Refresh(ctx, connect.NewRequest(&apiv1alpha.RefreshRequest{RefreshToken: next.RefreshToken}))
	wantCode(t, err, connect.CodeUnauthenticated)
}

func TestLoginReusesDevice(t *testing.T) {
	h := newHarness(t)
	first := h.bootstrap(t)
	resp, err := h.auth.Login(context.Background(), connect.NewRequest(&apiv1alpha.LoginRequest{
		Username: "luna",
		Password: "first admin password",
		Device:   &apiv1alpha.DeviceInfo{DeviceId: first.DeviceId, Name: "Renamed"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Credentials.DeviceId != first.DeviceId {
		t.Error("login with a known device id registered a new device")
	}
	if h.login(t, "luna", "first admin password").DeviceId == first.DeviceId {
		t.Error("login without a device id reused a device")
	}
}

func TestProtectedCallsNeedToken(t *testing.T) {
	h := newHarness(t)
	_, err := h.auth.GetCurrentUser(context.Background(), connect.NewRequest(&apiv1alpha.GetCurrentUserRequest{}))
	wantCode(t, err, connect.CodeUnauthenticated)

	garbage := &apiv1alpha.Credentials{AccessToken: "not.a.token"}
	_, err = h.adminClient(garbage).ListUsers(context.Background(), connect.NewRequest(&apiv1alpha.ListUsersRequest{}))
	wantCode(t, err, connect.CodeUnauthenticated)
}

func TestLoginRateLimit(t *testing.T) {
	h := newHarness(t)
	h.bootstrap(t)
	var err error
	for range 10 {
		_, err = h.auth.Login(context.Background(), connect.NewRequest(&apiv1alpha.LoginRequest{Username: "luna", Password: "wrong password"}))
		if connect.CodeOf(err) == connect.CodeResourceExhausted {
			return
		}
	}
	t.Fatalf("10 wrong passwords were never rate limited; last error %v", err)
}

func TestAdminUserManagement(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adminCreds := h.bootstrap(t)
	adm := h.adminClient(adminCreds)

	created, err := adm.CreateUser(ctx, connect.NewRequest(&apiv1alpha.CreateUserRequest{
		Username: "pearl", Password: "member password", Role: apiv1alpha.Role_ROLE_MEMBER,
	}))
	if err != nil {
		t.Fatal(err)
	}
	pearl := created.Msg.User

	_, err = adm.CreateUser(ctx, connect.NewRequest(&apiv1alpha.CreateUserRequest{
		Username: "Pearl", Password: "member password", Role: apiv1alpha.Role_ROLE_MEMBER,
	}))
	wantCode(t, err, connect.CodeAlreadyExists)
	_, err = adm.CreateUser(ctx, connect.NewRequest(&apiv1alpha.CreateUserRequest{Username: "no spaces", Password: "short"}))
	wantCode(t, err, connect.CodeInvalidArgument)

	// Members can't administer.
	memberCreds := h.login(t, "pearl", "member password")
	_, err = h.adminClient(memberCreds).ListUsers(ctx, connect.NewRequest(&apiv1alpha.ListUsersRequest{}))
	wantCode(t, err, connect.CodePermissionDenied)

	list, err := adm.ListUsers(ctx, connect.NewRequest(&apiv1alpha.ListUsersRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Users) != 2 {
		t.Errorf("listed %d users, want 2", len(list.Msg.Users))
	}

	// A password change signs the user out everywhere.
	_, err = adm.UpdateUser(ctx, connect.NewRequest(&apiv1alpha.UpdateUserRequest{
		Id: pearl.Id, Password: "a new password", DisplayName: "Pearl",
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"password", "display_name"}},
	}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.auth.Refresh(ctx, connect.NewRequest(&apiv1alpha.RefreshRequest{RefreshToken: memberCreds.RefreshToken}))
	wantCode(t, err, connect.CodeUnauthenticated)
	h.login(t, "pearl", "a new password")

	if _, err := adm.DeleteUser(ctx, connect.NewRequest(&apiv1alpha.DeleteUserRequest{Id: pearl.Id})); err != nil {
		t.Fatal(err)
	}
	_, err = adm.DeleteUser(ctx, connect.NewRequest(&apiv1alpha.DeleteUserRequest{Id: pearl.Id}))
	wantCode(t, err, connect.CodeNotFound)
}

func TestLastAdminIsProtected(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)
	adm := h.adminClient(creds)

	_, err := adm.UpdateUser(ctx, connect.NewRequest(&apiv1alpha.UpdateUserRequest{
		Id: creds.User.Id, Role: apiv1alpha.Role_ROLE_MEMBER,
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"role"}},
	}))
	wantCode(t, err, connect.CodeFailedPrecondition)
	_, err = adm.DeleteUser(ctx, connect.NewRequest(&apiv1alpha.DeleteUserRequest{Id: creds.User.Id}))
	wantCode(t, err, connect.CodeFailedPrecondition)
}

func TestAdminNeedsRecentLogin(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)

	// Pretend the password was entered 11 minutes ago, then refresh: the new
	// access token carries the old authentication time.
	stale := time.Now().Add(-auth.AdminReauthWindow - time.Minute)
	if _, err := h.store.Pool.Exec(ctx, "UPDATE device SET authenticated_at = $1", stale); err != nil {
		t.Fatal(err)
	}
	refreshed, err := h.auth.Refresh(ctx, connect.NewRequest(&apiv1alpha.RefreshRequest{RefreshToken: creds.RefreshToken}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.adminClient(refreshed.Msg.Credentials).ListUsers(ctx, connect.NewRequest(&apiv1alpha.ListUsersRequest{}))
	wantCode(t, err, connect.CodePermissionDenied)
	var cerr *connect.Error
	if !errors.As(err, &cerr) || cerr.Message() != auth.ErrReauthRequired {
		t.Errorf("error %v does not ask the admin to sign in again", err)
	}

	// Signing in again restores access.
	fresh := h.login(t, "luna", "first admin password")
	if _, err := h.adminClient(fresh).ListUsers(ctx, connect.NewRequest(&apiv1alpha.ListUsersRequest{})); err != nil {
		t.Fatal(err)
	}
}
