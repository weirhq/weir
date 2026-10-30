package apitest

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/durationpb"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

func itemID(t *testing.T, h *harness, title string) string {
	t.Helper()
	var id string
	if err := h.store.Pool.QueryRow(context.Background(), "SELECT id FROM item WHERE title = $1", title).Scan(&id); err != nil {
		t.Fatalf("item %q: %v", title, err)
	}
	return id
}

func TestWatchProgress(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)
	films := h.scanFolder(t, library.Movies, "films", "Arrival (2016).mp4", "Zodiac (2007).mp4")
	h.scanFolder(t, library.Shows, "tv",
		"Severance (2022)/Season 01/Severance - S01E01.mp4", "Severance (2022)/Season 01/Severance - S01E02.mp4")
	// filmProber files have no duration; give Arrival one.
	if _, err := h.store.Pool.Exec(ctx, "UPDATE media_file SET duration_ms = 6960000"); err != nil {
		t.Fatal(err)
	}
	play := apiv1alpha.NewPlaybackClient(http.DefaultClient, h.url, bearer(creds))
	browse := apiv1alpha.NewBrowseClient(http.DefaultClient, h.url, bearer(creds))
	arrival := itemID(t, h, "Arrival")

	// Direct play has no session; heartbeats still record progress.
	if _, err := play.Heartbeat(ctx, connect.NewRequest(&apiv1alpha.HeartbeatRequest{ItemId: arrival, Position: durationpb.New(40 * time.Minute)})); err != nil {
		t.Fatal(err)
	}
	cw, err := browse.ListContinueWatching(ctx, connect.NewRequest(&apiv1alpha.ListContinueWatchingRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cw.Msg.Items) != 1 || cw.Msg.Items[0].UserData.Position.AsDuration() != 40*time.Minute {
		t.Fatalf("continue watching %v", cw.Msg.Items)
	}

	// Stopping in the credits finishes it.
	if _, err := play.Stop(ctx, connect.NewRequest(&apiv1alpha.StopRequest{ItemId: arrival, Position: durationpb.New(110 * time.Minute)})); err != nil {
		t.Fatal(err)
	}
	cw, _ = browse.ListContinueWatching(ctx, connect.NewRequest(&apiv1alpha.ListContinueWatchingRequest{}))
	if len(cw.Msg.Items) != 0 {
		t.Errorf("finished film still in continue watching: %v", cw.Msg.Items)
	}
	list, _ := browse.ListItems(ctx, connect.NewRequest(&apiv1alpha.ListItemsRequest{LibraryId: films.String()}))
	if ud := list.Msg.Items[0].UserData; ud == nil || !ud.Watched || ud.PlayCount != 1 {
		t.Errorf("Arrival user data %v", ud)
	}
	if list.Msg.Items[1].UserData != nil {
		t.Errorf("Zodiac has user data without being played: %v", list.Msg.Items[1].UserData)
	}

	// Marking a show watched marks every episode.
	show := itemID(t, h, "Severance")
	if _, err := play.SetWatched(ctx, connect.NewRequest(&apiv1alpha.SetWatchedRequest{ItemId: show, Watched: true})); err != nil {
		t.Fatal(err)
	}
	var watched int
	_ = h.store.Pool.QueryRow(ctx, `SELECT count(*) FROM playback_state ps JOIN item i ON i.id = ps.item_id WHERE i.kind = 'episode' AND ps.watched`).Scan(&watched)
	if watched != 2 {
		t.Errorf("%d episodes watched, want 2", watched)
	}
	_, err = play.SetWatched(ctx, connect.NewRequest(&apiv1alpha.SetWatchedRequest{ItemId: uuid.Must(uuid.NewV7()).String(), Watched: true}))
	wantCode(t, err, connect.CodeNotFound)

	recent, err := browse.ListRecentlyAdded(ctx, connect.NewRequest(&apiv1alpha.ListRecentlyAddedRequest{}))
	if err != nil || len(recent.Msg.Items) != 3 || recent.Msg.Items[0].Kind != apiv1alpha.ItemKind_ITEM_KIND_SHOW {
		t.Errorf("recently added (newest first): %v %v", recent, err)
	}
}

func encode(t *testing.T, width, height int, asPNG bool) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for x := range width {
		for y := range height {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 128, 255})
		}
	}
	var buf bytes.Buffer
	var err error
	if asPNG {
		err = png.Encode(&buf, img)
	} else {
		err = jpeg.Encode(&buf, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestArtwork(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	adm := h.adminClient(h.bootstrap(t))
	h.scanFolder(t, library.Movies, "films", "Arrival (2016).mp4")
	arrival := uuid.MustParse(itemID(t, h, "Arrival"))

	// A local poster that has gone missing, and a TMDB one that works: the
	// server falls through to TMDB.
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write(encode(t, 600, 900, false))
	}))
	defer remote.Close()
	backdrop := filepath.Join(t.TempDir(), "fanart.png")
	if err := os.WriteFile(backdrop, encode(t, 1000, 500, true), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, a := range []dbgen.UpsertArtworkParams{
		{ItemID: arrival, Kind: "poster", Source: "local", Location: "/nonexistent/poster.jpg"},
		{ItemID: arrival, Kind: "poster", Source: "tmdb", Location: remote.URL + "/poster.jpg"},
		{ItemID: arrival, Kind: "backdrop", Source: "local", Location: backdrop},
	} {
		if err := h.store.UpsertArtwork(ctx, a); err != nil {
			t.Fatal(err)
		}
	}

	creds := h.login(t, "luna", "first admin password")
	browse := apiv1alpha.NewBrowseClient(http.DefaultClient, h.url, bearer(creds))
	item, err := browse.GetItem(ctx, connect.NewRequest(&apiv1alpha.GetItemRequest{Id: arrival.String()}))
	if err != nil {
		t.Fatal(err)
	}
	it := item.Msg.Item
	if it.Summary.PosterUrl == "" || it.BackdropUrl == "" || it.LogoUrl != "" || it.Summary.ThumbUrl != "" {
		t.Fatalf("urls: poster %q backdrop %q logo %q", it.Summary.PosterUrl, it.BackdropUrl, it.LogoUrl)
	}

	size := func(url string) (int, image.Config, string) {
		resp, err := http.Get(h.url + url)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		cfg, _, _ := image.DecodeConfig(resp.Body)
		return resp.StatusCode, cfg, resp.Header.Get("Content-Type")
	}
	if code, cfg, ct := size(it.Summary.PosterUrl); code != http.StatusOK || cfg.Width != 600 || ct != "image/jpeg" {
		t.Errorf("poster: %d %dx%d %s", code, cfg.Width, cfg.Height, ct)
	}
	if code, cfg, _ := size(it.Summary.PosterUrl + "&w=300"); code != http.StatusOK || cfg.Width != 320 || cfg.Height != 480 {
		t.Errorf("poster at w=300 (rounded up to 320): %d %dx%d", code, cfg.Width, cfg.Height)
	}
	if code, cfg, ct := size(it.BackdropUrl + "&w=780"); code != http.StatusOK || cfg.Width != 780 || ct != "image/png" {
		t.Errorf("backdrop: %d %dx%d %s", code, cfg.Width, cfg.Height, ct)
	}
	var hash *string
	_ = h.store.Pool.QueryRow(ctx, "SELECT hash FROM artwork WHERE source = 'tmdb'").Scan(&hash)
	if hash == nil {
		t.Error("the TMDB poster wasn't recorded as cached")
	}

	path, _, _ := bytes.Cut([]byte(it.Summary.PosterUrl), []byte("?"))
	if code, _, _ := size(string(path)); code != http.StatusForbidden {
		t.Errorf("unsigned: %d", code)
	}
	// A member without access to the library can't reach the item, so gets
	// no picture links.
	_, pearl := h.member(t, adm)
	theirs := apiv1alpha.NewBrowseClient(http.DefaultClient, h.url, bearer(pearl))
	if _, err := theirs.GetItem(ctx, connect.NewRequest(&apiv1alpha.GetItemRequest{Id: arrival.String()})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("member GetItem: %v", err)
	}
}
