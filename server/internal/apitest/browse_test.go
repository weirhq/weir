package apitest

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// scanFolder creates a library of kind over a folder holding files and
// scans it.
func (h *harness) scanFolder(t *testing.T, kind library.Kind, folder string, files ...string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	root := h.folder(t, folder)
	for _, f := range files {
		p := filepath.Join(root, f)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(f), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	lib := uuid.Must(uuid.NewV7())
	if _, err := h.store.CreateLibrary(ctx, dbgen.CreateLibraryParams{ID: lib, Name: folder, Kind: string(kind)}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.AddLibraryPath(ctx, dbgen.AddLibraryPathParams{LibraryID: lib, Path: root}); err != nil {
		t.Fatal(err)
	}
	if _, err := library.NewScanner(h.store, filmProber{}).Scan(ctx, lib); err != nil {
		t.Fatal(err)
	}
	return lib
}

func (h *harness) member(t *testing.T, adm apiv1alpha.AdminClient) (string, *apiv1alpha.Credentials) {
	t.Helper()
	resp, err := adm.CreateUser(context.Background(), connect.NewRequest(&apiv1alpha.CreateUserRequest{
		Username: "pearl", Password: "member password", Role: apiv1alpha.Role_ROLE_MEMBER,
	}))
	if err != nil {
		t.Fatal(err)
	}
	return resp.Msg.User.Id, h.login(t, "pearl", "member password")
}

func TestMembersSeeOnlyWhatTheyreGranted(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adm := h.adminClient(h.bootstrap(t))
	films := h.scanFolder(t, library.Movies, "films", "Arrival (2016).mp4", "Blade Runner (1982).mp4")
	h.scanFolder(t, library.Movies, "private", "Home Video (2020).mp4")
	pearlID, pearl := h.member(t, adm)
	browse := apiv1alpha.NewBrowseClient(http.DefaultClient, h.url, bearer(pearl))
	play := apiv1alpha.NewPlaybackClient(http.DefaultClient, h.url, bearer(pearl))

	var arrival string
	_ = h.store.Pool.QueryRow(ctx, "SELECT id FROM item WHERE title = 'Arrival'").Scan(&arrival)

	// No access yet: nothing visible, and items don't admit to existing.
	libs, err := browse.ListVisibleLibraries(ctx, connect.NewRequest(&apiv1alpha.ListVisibleLibrariesRequest{}))
	if err != nil || len(libs.Msg.Libraries) != 0 {
		t.Fatalf("libraries before access: %v %v", libs, err)
	}
	_, err = browse.GetItem(ctx, connect.NewRequest(&apiv1alpha.GetItemRequest{Id: arrival}))
	wantCode(t, err, connect.CodeNotFound)
	_, err = play.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: arrival, Capabilities: browserCaps()}))
	wantCode(t, err, connect.CodeNotFound)
	if found, _ := browse.Search(ctx, connect.NewRequest(&apiv1alpha.SearchRequest{Query: "arrival"})); len(found.Msg.Items) != 0 {
		t.Errorf("search found %v without access", found.Msg.Items)
	}

	// View only: browse, search, but not play.
	if _, err := adm.SetLibraryAccess(ctx, connect.NewRequest(&apiv1alpha.SetLibraryAccessRequest{
		UserId: pearlID, Access: []*apiv1alpha.LibraryAccess{{LibraryId: films.String(), View: true}},
	})); err != nil {
		t.Fatal(err)
	}
	libs, _ = browse.ListVisibleLibraries(ctx, connect.NewRequest(&apiv1alpha.ListVisibleLibrariesRequest{}))
	if len(libs.Msg.Libraries) != 1 || libs.Msg.Libraries[0].Name != "films" || len(libs.Msg.Libraries[0].Paths) != 0 {
		t.Errorf("visible libraries %v (members don't see folder paths)", libs.Msg.Libraries)
	}
	item, err := browse.GetItem(ctx, connect.NewRequest(&apiv1alpha.GetItemRequest{Id: arrival}))
	if err != nil {
		t.Fatal(err)
	}
	if v := item.Msg.Item.Versions; len(v) != 1 || len(v[0].Streams) != 2 || v[0].Streams[0].Width != 1920 {
		t.Errorf("versions %v", v)
	}
	found, err := browse.Search(ctx, connect.NewRequest(&apiv1alpha.SearchRequest{Query: "arival"}))
	if err != nil || len(found.Msg.Items) == 0 || found.Msg.Items[0].Title != "Arrival" {
		t.Errorf("typo search: %v %v", found, err)
	}
	if found, _ := browse.Search(ctx, connect.NewRequest(&apiv1alpha.SearchRequest{Query: "home video"})); len(found.Msg.Items) != 0 {
		t.Errorf("search reached a library without access: %v", found.Msg.Items)
	}
	_, err = play.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: arrival, Capabilities: browserCaps()}))
	wantCode(t, err, connect.CodePermissionDenied)

	// Play implies view.
	if _, err := adm.SetLibraryAccess(ctx, connect.NewRequest(&apiv1alpha.SetLibraryAccessRequest{
		UserId: pearlID, Access: []*apiv1alpha.LibraryAccess{{LibraryId: films.String(), Play: true}},
	})); err != nil {
		t.Fatal(err)
	}
	if _, err := play.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: arrival, Capabilities: browserCaps()})); err != nil {
		t.Errorf("start with play access: %v", err)
	}
	got, _ := adm.GetLibraryAccess(ctx, connect.NewRequest(&apiv1alpha.GetLibraryAccessRequest{UserId: pearlID}))
	if a := got.Msg.Access; len(a) != 1 || !a[0].View || !a[0].Play || a[0].Manage {
		t.Errorf("stored access %v", a)
	}

	_, err = adm.SetLibraryAccess(ctx, connect.NewRequest(&apiv1alpha.SetLibraryAccessRequest{
		UserId: pearlID, Access: []*apiv1alpha.LibraryAccess{{LibraryId: uuid.Must(uuid.NewV7()).String(), View: true}},
	}))
	wantCode(t, err, connect.CodeInvalidArgument)
	_, err = adm.GetLibraryAccess(ctx, connect.NewRequest(&apiv1alpha.GetLibraryAccessRequest{UserId: uuid.Must(uuid.NewV7()).String()}))
	wantCode(t, err, connect.CodeNotFound)
}

func TestListItemsPagesAndBreadcrumbs(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)
	browse := apiv1alpha.NewBrowseClient(http.DefaultClient, h.url, bearer(creds))
	films := h.scanFolder(t, library.Movies, "films",
		"Alien (1979).mp4", "Arrival (2016).mp4", "Blade Runner (1982).mp4", "The Thing (1982).mp4", "Zodiac (2007).mp4")
	shows := h.scanFolder(t, library.Shows, "tv",
		"Severance (2022)/Season 01/Severance - S01E02 - Half Loop.mp4",
		"Severance (2022)/Season 01/Severance - S01E01 - Good News About Hell.mp4")

	var titles []string
	token := ""
	for pages := 0; ; pages++ {
		resp, err := browse.ListItems(ctx, connect.NewRequest(&apiv1alpha.ListItemsRequest{LibraryId: films.String(), PageSize: 2, PageToken: token}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Msg.Total != 5 {
			t.Errorf("total %d", resp.Msg.Total)
		}
		for _, it := range resp.Msg.Items {
			titles = append(titles, it.Title)
		}
		if token = resp.Msg.NextPageToken; token == "" {
			if pages != 2 {
				t.Errorf("%d pages, want 3", pages+1)
			}
			break
		}
	}
	// Sorted by title, ignoring "The".
	want := []string{"Alien", "Arrival", "Blade Runner", "The Thing", "Zodiac"}
	if len(titles) != 5 || titles[3] != want[3] || titles[4] != want[4] {
		t.Errorf("titles %v, want %v", titles, want)
	}

	byYear, _ := browse.ListItems(ctx, connect.NewRequest(&apiv1alpha.ListItemsRequest{LibraryId: films.String(), Sort: apiv1alpha.ItemSort_ITEM_SORT_YEAR}))
	if byYear.Msg.Items[0].Title != "Arrival" {
		t.Errorf("newest first: %v", byYear.Msg.Items[0])
	}

	top, _ := browse.ListItems(ctx, connect.NewRequest(&apiv1alpha.ListItemsRequest{LibraryId: shows.String()}))
	seasons, _ := browse.ListItems(ctx, connect.NewRequest(&apiv1alpha.ListItemsRequest{ParentId: top.Msg.Items[0].Id}))
	episodes, err := browse.ListItems(ctx, connect.NewRequest(&apiv1alpha.ListItemsRequest{ParentId: seasons.Msg.Items[0].Id}))
	if err != nil || len(episodes.Msg.Items) != 2 || episodes.Msg.Items[0].IndexNumber != 1 {
		t.Fatalf("episodes in index order: %v %v", episodes, err)
	}
	ep, err := browse.GetItem(ctx, connect.NewRequest(&apiv1alpha.GetItemRequest{Id: episodes.Msg.Items[1].Id}))
	if err != nil {
		t.Fatal(err)
	}
	a := ep.Msg.Item.Ancestors
	if len(a) != 2 || a[0].Kind != apiv1alpha.ItemKind_ITEM_KIND_SHOW || a[1].Kind != apiv1alpha.ItemKind_ITEM_KIND_SEASON {
		t.Errorf("ancestors %v", a)
	}

	_, err = browse.ListItems(ctx, connect.NewRequest(&apiv1alpha.ListItemsRequest{}))
	wantCode(t, err, connect.CodeInvalidArgument)
}
