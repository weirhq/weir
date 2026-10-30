package apitest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
)

func (h *harness) folder(t *testing.T, rel string) string {
	t.Helper()
	p := filepath.Join(h.media, rel)
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

// queuedScans counts scan jobs waiting to run for the library.
func (h *harness) queuedScans(t *testing.T, libraryID string) int {
	t.Helper()
	var n int
	err := h.store.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM river_job WHERE kind = 'scan_library' AND state = 'available' AND args->>'library_id' = $1`,
		libraryID).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLibraryLifecycle(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adm := h.adminClient(h.bootstrap(t))
	films := h.folder(t, "films")

	created, err := adm.CreateLibrary(ctx, connect.NewRequest(&apiv1alpha.CreateLibraryRequest{
		Name: "Films", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{films + "/"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	lib := created.Msg.Library
	if lib.Kind != apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES || len(lib.Paths) != 1 || lib.Paths[0] != films {
		t.Errorf("created %v; paths should be cleaned", lib)
	}
	if n := h.queuedScans(t, lib.Id); n != 1 {
		t.Errorf("%d scans queued after create, want 1", n)
	}

	// A second request while one is queued is absorbed.
	if _, err := adm.ScanLibrary(ctx, connect.NewRequest(&apiv1alpha.ScanLibraryRequest{Id: lib.Id})); err != nil {
		t.Fatal(err)
	}
	if n := h.queuedScans(t, lib.Id); n != 1 {
		t.Errorf("%d scans queued after a repeat request, want 1", n)
	}

	more := h.folder(t, "more films")
	updated, err := adm.UpdateLibrary(ctx, connect.NewRequest(&apiv1alpha.UpdateLibraryRequest{
		Id: lib.Id, Name: "Movies", Paths: []string{films, more},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"name", "paths"}},
	}))
	if err != nil {
		t.Fatal(err)
	}
	if updated.Msg.Library.Name != "Movies" || len(updated.Msg.Library.Paths) != 2 {
		t.Errorf("updated to %v", updated.Msg.Library)
	}

	list, err := adm.ListLibraries(ctx, connect.NewRequest(&apiv1alpha.ListLibrariesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Msg.Libraries) != 1 || len(list.Msg.Libraries[0].Paths) != 2 {
		t.Errorf("listed %v", list.Msg.Libraries)
	}

	if _, err := adm.DeleteLibrary(ctx, connect.NewRequest(&apiv1alpha.DeleteLibraryRequest{Id: lib.Id})); err != nil {
		t.Fatal(err)
	}
	_, err = adm.ScanLibrary(ctx, connect.NewRequest(&apiv1alpha.ScanLibraryRequest{Id: lib.Id}))
	wantCode(t, err, connect.CodeNotFound)
}

func TestLibraryPathsAreChecked(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adm := h.adminClient(h.bootstrap(t))
	music := h.folder(t, "music")
	if _, err := adm.CreateLibrary(ctx, connect.NewRequest(&apiv1alpha.CreateLibraryRequest{
		Name: "Music", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MUSIC, Paths: []string{music},
	})); err != nil {
		t.Fatal(err)
	}

	for name, req := range map[string]*apiv1alpha.CreateLibraryRequest{
		"relative path":         {Name: "X", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{"films"}},
		"outside library_paths": {Name: "X", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{t.TempDir()}},
		"missing folder":        {Name: "X", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{filepath.Join(h.media, "nope")}},
		"inside another":        {Name: "X", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{h.folder(t, "music/live")}},
		"containing another":    {Name: "X", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{h.media}},
		"no folders":            {Name: "X", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES},
		"no kind":               {Name: "X", Paths: []string{h.folder(t, "films")}},
		"blank name":            {Name: " ", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{h.folder(t, "films")}},
	} {
		_, err := adm.CreateLibrary(ctx, connect.NewRequest(req))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: got %v, want InvalidArgument", name, err)
		}
	}

	// Every problem is reported at once.
	_, err := adm.CreateLibrary(ctx, connect.NewRequest(&apiv1alpha.CreateLibraryRequest{
		Name: "", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{"relative"},
	}))
	if msg := err.Error(); !strings.Contains(msg, "library name") || !strings.Contains(msg, "absolute path") {
		t.Errorf("error doesn't list both problems: %v", err)
	}
}

func TestMembersCannotManageLibraries(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adm := h.adminClient(h.bootstrap(t))
	if _, err := adm.CreateUser(ctx, connect.NewRequest(&apiv1alpha.CreateUserRequest{
		Username: "pearl", Password: "member password", Role: apiv1alpha.Role_ROLE_MEMBER,
	})); err != nil {
		t.Fatal(err)
	}
	member := h.adminClient(h.login(t, "pearl", "member password"))
	_, err := member.ListLibraries(ctx, connect.NewRequest(&apiv1alpha.ListLibrariesRequest{}))
	wantCode(t, err, connect.CodePermissionDenied)
}
