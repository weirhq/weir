package apitest

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
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

func TestListItemsFiltersAndFacets(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)
	browse := apiv1alpha.NewBrowseClient(http.DefaultClient, h.url, bearer(creds))
	play := apiv1alpha.NewPlaybackClient(http.DefaultClient, h.url, bearer(creds))
	films := h.scanFolder(t, library.Movies, "films",
		"Alien (1979).mp4", "Arrival (2016).mp4", "Blade Runner (1982).mp4", "The Thing (1982).mp4", "Zodiac (2007).mp4")
	shows := h.scanFolder(t, library.Shows, "tv",
		"Severance (2022)/Season 01/Severance - S01E01.mp4", "Severance (2022)/Season 01/Severance - S01E02.mp4")
	meta := func(title, release string, genres ...string) {
		t.Helper()
		if _, err := h.store.Pool.Exec(ctx, "INSERT INTO metadata (item_id, source, genres, release_date) VALUES ($1, 'tmdb', $2, nullif($3, '')::date)",
			itemID(t, h, title), genres, release); err != nil {
			t.Fatal(err)
		}
	}
	meta("Alien", "2003-10-31", "Horror", "Science Fiction") // the director's cut
	meta("The Thing", "", "Horror")
	meta("Arrival", "2016-11-11", "Science Fiction")
	meta("Blade Runner", "", "Science Fiction")
	list := func(req *apiv1alpha.ListItemsRequest) []string {
		t.Helper()
		resp, err := browse.ListItems(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatal(err)
		}
		var titles []string
		for _, it := range resp.Msg.Items {
			titles = append(titles, it.Title)
		}
		return titles
	}
	same := func(what string, got []string, want ...string) {
		t.Helper()
		if !slices.Equal(got, want) {
			t.Errorf("%s: %v, want %v", what, got, want)
		}
	}

	same("horror", list(&apiv1alpha.ListItemsRequest{LibraryId: films.String(), Genre: "Horror"}), "Alien", "The Thing")
	same("the 1980s", list(&apiv1alpha.ListItemsRequest{LibraryId: films.String(), Decade: 1980}), "Blade Runner", "The Thing")
	// By release date where there is one, else by year.
	same("recently released", list(&apiv1alpha.ListItemsRequest{LibraryId: films.String(), Sort: apiv1alpha.ItemSort_ITEM_SORT_RELEASED}),
		"Arrival", "Zodiac", "Alien", "Blade Runner", "The Thing")

	if _, err := play.SetWatched(ctx, connect.NewRequest(&apiv1alpha.SetWatchedRequest{ItemId: itemID(t, h, "Arrival"), Watched: true})); err != nil {
		t.Fatal(err)
	}
	same("unwatched films", list(&apiv1alpha.ListItemsRequest{LibraryId: films.String(), Unwatched: true}),
		"Alien", "Blade Runner", "The Thing", "Zodiac")
	// A show is unwatched until every episode is watched.
	if _, err := play.SetWatched(ctx, connect.NewRequest(&apiv1alpha.SetWatchedRequest{ItemId: itemID(t, h, "Episode 1"), Watched: true})); err != nil {
		t.Fatal(err)
	}
	same("a show part-watched", list(&apiv1alpha.ListItemsRequest{LibraryId: shows.String(), Unwatched: true}), "Severance")
	if _, err := play.SetWatched(ctx, connect.NewRequest(&apiv1alpha.SetWatchedRequest{ItemId: itemID(t, h, "Episode 2"), Watched: true})); err != nil {
		t.Fatal(err)
	}
	same("a show watched", list(&apiv1alpha.ListItemsRequest{LibraryId: shows.String(), Unwatched: true}))

	facets, err := browse.ListLibraryFacets(ctx, connect.NewRequest(&apiv1alpha.ListLibraryFacetsRequest{LibraryId: films.String()}))
	if err != nil {
		t.Fatal(err)
	}
	var genres, decades []string
	for _, g := range facets.Msg.Genres {
		genres = append(genres, fmt.Sprintf("%s %d", g.Genre, g.Count))
	}
	for _, d := range facets.Msg.Decades {
		decades = append(decades, fmt.Sprintf("%d %d", d.Decade, d.Count))
	}
	same("genres, most first", genres, "Science Fiction 3", "Horror 2")
	same("decades, newest first", decades, "2010 1", "2000 1", "1980 2", "1970 1")
	_, err = browse.ListLibraryFacets(ctx, connect.NewRequest(&apiv1alpha.ListLibraryFacetsRequest{LibraryId: uuid.Must(uuid.NewV7()).String()}))
	wantCode(t, err, connect.CodeNotFound)
}

func TestPeople(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)
	browse := apiv1alpha.NewBrowseClient(http.DefaultClient, h.url, bearer(creds))
	h.scanFolder(t, library.Movies, "films", "Arrival (2016).mp4", "Enchanted (2007).mp4", "Zodiac (2007).mp4")
	cast := func(title, people string) {
		t.Helper()
		if _, err := h.store.Pool.Exec(ctx, "INSERT INTO metadata (item_id, source, cast_members) VALUES ($1, 'tmdb', $2)", itemID(t, h, title), people); err != nil {
			t.Fatal(err)
		}
	}
	cast("Arrival", `[{"id":"9273","name":"Amy Adams","role":"Louise Banks","photo":"https://img.test/amy.jpg"},{"id":"17604","name":"Jeremy Renner"}]`)
	cast("Enchanted", `[{"id":"9273","name":"Amy Adams","role":"Giselle"}]`)
	cast("Zodiac", `[{"id":"131","name":"Jake Gyllenhaal"}]`)

	item, err := browse.GetItem(ctx, connect.NewRequest(&apiv1alpha.GetItemRequest{Id: itemID(t, h, "Arrival")}))
	if err != nil || item.Msg.Item.Cast[0].Id != "9273" {
		t.Fatalf("cast ids: %v %v", item, err)
	}
	amy, err := browse.GetPerson(ctx, connect.NewRequest(&apiv1alpha.GetPersonRequest{Id: "9273"}))
	if err != nil {
		t.Fatal(err)
	}
	var credits []string
	for _, c := range amy.Msg.Credits {
		credits = append(credits, c.Item.Title+" as "+c.Role)
	}
	if amy.Msg.Name != "Amy Adams" || !slices.Equal(credits, []string{"Arrival as Louise Banks", "Enchanted as Giselle"}) {
		t.Errorf("person %q credits %v", amy.Msg.Name, credits)
	}
	// Her photo is Arrival's cast photo, the first she's in with one.
	if !strings.Contains(amy.Msg.PhotoUrl, itemID(t, h, "Arrival")+"/cast/0?") {
		t.Errorf("photo %q", amy.Msg.PhotoUrl)
	}
	_, err = browse.GetPerson(ctx, connect.NewRequest(&apiv1alpha.GetPersonRequest{Id: "1"}))
	wantCode(t, err, connect.CodeNotFound)
	_, err = browse.GetPerson(ctx, connect.NewRequest(&apiv1alpha.GetPersonRequest{}))
	wantCode(t, err, connect.CodeNotFound)
}
