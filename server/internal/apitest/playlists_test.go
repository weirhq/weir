package apitest

import (
	"context"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/library"
)

func titles(items []*apiv1alpha.ItemSummary) []string {
	var out []string
	for _, it := range items {
		out = append(out, it.Title)
	}
	return out
}

func TestPlaylists(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adminCreds := h.bootstrap(t)
	adm := h.adminClient(adminCreds)
	films := h.scanFolder(t, library.Movies, "films", "Arrival (2016).mp4", "Zodiac (2007).mp4")
	h.scanFolder(t, library.Shows, "tv", "Severance (2022)/Season 01/Severance - S01E01 - Good News About Hell.mp4")
	mine := apiv1alpha.NewPlaylistsClient(http.DefaultClient, h.url, bearer(adminCreds))

	arrival, zodiac := itemID(t, h, "Arrival"), itemID(t, h, "Zodiac")
	episode, show := itemID(t, h, "Good News About Hell"), itemID(t, h, "Severance")

	_, err := mine.CreatePlaylist(ctx, connect.NewRequest(&apiv1alpha.CreatePlaylistRequest{Name: "Mixed", ItemIds: []string{show}}))
	wantCode(t, err, connect.CodeInvalidArgument)

	created, err := mine.CreatePlaylist(ctx, connect.NewRequest(&apiv1alpha.CreatePlaylistRequest{
		Name: "Friday", ItemIds: []string{zodiac, episode, arrival, zodiac}, Shared: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	id := created.Msg.Playlist.Id
	got, err := mine.GetPlaylist(ctx, connect.NewRequest(&apiv1alpha.GetPlaylistRequest{Id: id}))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"Zodiac", "Good News About Hell", "Arrival", "Zodiac"}; !equal(titles(got.Msg.Items), want) {
		t.Errorf("items %v, want %v (order kept, repeats allowed)", titles(got.Msg.Items), want)
	}

	// A member with access to films only sees the shared playlist without
	// the episode, and can't change it.
	pearlID, pearl := h.member(t, adm)
	if _, err := adm.SetLibraryAccess(ctx, connect.NewRequest(&apiv1alpha.SetLibraryAccessRequest{
		UserId: pearlID, Access: []*apiv1alpha.LibraryAccess{{LibraryId: films.String(), View: true}},
	})); err != nil {
		t.Fatal(err)
	}
	theirs := apiv1alpha.NewPlaylistsClient(http.DefaultClient, h.url, bearer(pearl))
	list, err := theirs.ListPlaylists(ctx, connect.NewRequest(&apiv1alpha.ListPlaylistsRequest{}))
	if err != nil || len(list.Msg.Playlists) != 1 || list.Msg.Playlists[0].ItemCount != 3 || list.Msg.Playlists[0].OwnerName != "luna" {
		t.Fatalf("member's list %v %v", list, err)
	}
	seen, _ := theirs.GetPlaylist(ctx, connect.NewRequest(&apiv1alpha.GetPlaylistRequest{Id: id}))
	if !equal(titles(seen.Msg.Items), []string{"Zodiac", "Arrival", "Zodiac"}) {
		t.Errorf("member sees %v", titles(seen.Msg.Items))
	}
	_, err = theirs.DeletePlaylist(ctx, connect.NewRequest(&apiv1alpha.DeletePlaylistRequest{Id: id}))
	wantCode(t, err, connect.CodePermissionDenied)

	// Unshared, it's gone from their view.
	if _, err := mine.UpdatePlaylist(ctx, connect.NewRequest(&apiv1alpha.UpdatePlaylistRequest{
		Id: id, Name: "Friday night", Shared: false, ItemIds: []string{arrival},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"name", "shared", "item_ids"}},
	})); err != nil {
		t.Fatal(err)
	}
	_, err = theirs.GetPlaylist(ctx, connect.NewRequest(&apiv1alpha.GetPlaylistRequest{Id: id}))
	wantCode(t, err, connect.CodeNotFound)
	got, _ = mine.GetPlaylist(ctx, connect.NewRequest(&apiv1alpha.GetPlaylistRequest{Id: id}))
	if got.Msg.Playlist.Name != "Friday night" || !equal(titles(got.Msg.Items), []string{"Arrival"}) {
		t.Errorf("after update %v %v", got.Msg.Playlist, titles(got.Msg.Items))
	}

	if _, err := mine.DeletePlaylist(ctx, connect.NewRequest(&apiv1alpha.DeletePlaylistRequest{Id: id})); err != nil {
		t.Fatal(err)
	}
	_, err = mine.GetPlaylist(ctx, connect.NewRequest(&apiv1alpha.GetPlaylistRequest{Id: id}))
	wantCode(t, err, connect.CodeNotFound)
}

func TestServerStatus(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adm := h.adminClient(h.bootstrap(t))
	h.engineStatus.healthy = true
	h.engineStatus.caps = &enginev1alpha.CapabilitiesResponse{EngineVersion: "0.1.0", FfmpegVersion: "9.0.2", MaxSessions: 2,
		Devices: []*enginev1alpha.HardwareDevice{{Api: enginev1alpha.HardwareApi_HARDWARE_API_VAAPI, Name: "Intel UHD Graphics 770"}}}
	h.engineStatus.health = &enginev1alpha.HealthResponse{ActiveSessions: 1}
	films := h.folder(t, "films")
	if _, err := adm.CreateLibrary(ctx, connect.NewRequest(&apiv1alpha.CreateLibraryRequest{
		Name: "Films", Kind: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES, Paths: []string{films},
	})); err != nil {
		t.Fatal(err)
	}
	resp, err := adm.GetServerStatus(ctx, connect.NewRequest(&apiv1alpha.GetServerStatusRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	e := resp.Msg.Engine
	if !e.Healthy || e.EngineVersion != "0.1.0" || e.ActiveSessions != 1 || len(e.Hardware) != 1 || e.Hardware[0] != "VAAPI: Intel UHD Graphics 770" {
		t.Errorf("engine %v", e)
	}
	if j := resp.Msg.RecentJobs; len(j) != 1 || j[0].Kind != "scan_library" || j[0].State != apiv1alpha.JobState_JOB_STATE_WAITING || j[0].LibraryId == "" {
		t.Errorf("jobs %v", j)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
