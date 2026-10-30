package apitest

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/grpc"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// filmProber probes an H.264/AAC MP4 and an HEVC Dolby Vision 8.1 MKV.
type filmProber struct{}

func (filmProber) Probe(_ context.Context, req *enginev1alpha.ProbeRequest, _ ...grpc.CallOption) (*enginev1alpha.ProbeResponse, error) {
	video := &enginev1alpha.Stream{Index: 0, Kind: enginev1alpha.StreamKind_STREAM_KIND_VIDEO, Codec: "h264",
		Detail: &enginev1alpha.Stream_Video{Video: &enginev1alpha.VideoDetail{Width: 1920, Height: 1080, BitDepth: 8, HdrFormat: enginev1alpha.HdrFormat_HDR_FORMAT_SDR}}}
	container := "mov,mp4,m4a,3gp,3g2,mj2"
	if strings.HasSuffix(req.Path, ".mkv") {
		container = "matroska,webm"
		video = &enginev1alpha.Stream{Index: 0, Kind: enginev1alpha.StreamKind_STREAM_KIND_VIDEO, Codec: "hevc",
			Detail: &enginev1alpha.Stream_Video{Video: &enginev1alpha.VideoDetail{Width: 3840, Height: 2160, BitDepth: 10,
				HdrFormat: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION, DolbyVision: &enginev1alpha.DolbyVision{Profile: 8, BlCompatId: 1, RpuPresent: true}}}}
	}
	return &enginev1alpha.ProbeResponse{ProbeHash: "hash:" + req.Path, Container: container, BitRate: 8_000_000, Streams: []*enginev1alpha.Stream{
		video,
		{Index: 1, Kind: enginev1alpha.StreamKind_STREAM_KIND_AUDIO, Codec: "aac", Language: "en",
			Detail: &enginev1alpha.Stream_Audio{Audio: &enginev1alpha.AudioDetail{Channels: 2}}},
	}}, nil
}

// arrival scans a film with an MP4 and a DV MKV version and returns its id.
func (h *harness) arrival(t *testing.T) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	dir := h.folder(t, "films/Arrival (2016)")
	for _, name := range []string{"Arrival (2016) - 1080p.mp4", "Arrival (2016) - 4K DV.mkv"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("bytes of "+name), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	lib := uuid.Must(uuid.NewV7())
	if _, err := h.store.CreateLibrary(ctx, dbgen.CreateLibraryParams{ID: lib, Name: "Films", Kind: "movies"}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.AddLibraryPath(ctx, dbgen.AddLibraryPathParams{LibraryID: lib, Path: filepath.Dir(dir)}); err != nil {
		t.Fatal(err)
	}
	if _, err := library.NewScanner(h.store, filmProber{}).Scan(ctx, lib); err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	if err := h.store.Pool.QueryRow(ctx, "SELECT id FROM item WHERE kind = 'movie'").Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func browserCaps() *apiv1alpha.ClientCapabilities {
	return &apiv1alpha.ClientCapabilities{
		Containers:  []string{"mp4", "webm"},
		VideoCodecs: []*apiv1alpha.VideoCodecSupport{{Codec: "h264"}},
		AudioCodecs: []*apiv1alpha.AudioCodecSupport{{Codec: "aac", MaxChannels: 2}},
		PlainUrl:    true, Hls: true,
	}
}

func TestStartPicksTheVersionThatPlaysDirectly(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)
	item := h.arrival(t)
	client := apiv1alpha.NewPlaybackClient(http.DefaultClient, h.url, bearer(creds))

	resp, err := client.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: item.String(), Capabilities: browserCaps()}))
	if err != nil {
		t.Fatal(err)
	}
	plan := resp.Msg.Plan
	if plan.Method != apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_DIRECT_PLAY || plan.Output.Container != "mp4" || plan.Url == "" {
		t.Fatalf("plan %v", plan)
	}

	// The signed URL serves the file, ranges and all.
	req, _ := http.NewRequest(http.MethodGet, h.url+plan.Url, nil)
	req.Header.Set("Range", "bytes=0-7")
	got, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(got.Body)
	got.Body.Close()
	if got.StatusCode != http.StatusPartialContent || string(body) != "bytes of" {
		t.Errorf("media URL: %d %q", got.StatusCode, body)
	}

	// The same client again is answered from the decision cache.
	var cached int
	_ = h.store.Pool.QueryRow(ctx, "SELECT count(*) FROM playback_decision").Scan(&cached)
	if _, err := client.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: item.String(), Capabilities: browserCaps()})); err != nil {
		t.Fatal(err)
	}
	var again int
	_ = h.store.Pool.QueryRow(ctx, "SELECT count(*) FROM playback_decision").Scan(&again)
	if cached != 2 || again != 2 {
		t.Errorf("decisions cached: %d then %d, want 2 (one per version)", cached, again)
	}
}

func TestStartWithAChosenVersionAndErrors(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	creds := h.bootstrap(t)
	item := h.arrival(t)
	client := apiv1alpha.NewPlaybackClient(http.DefaultClient, h.url, bearer(creds))

	var dvVersion string
	_ = h.store.Pool.QueryRow(ctx, "SELECT id FROM version WHERE edition = '4K DV'").Scan(&dvVersion)
	resp, err := client.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: item.String(), VersionId: dvVersion, Capabilities: browserCaps()}))
	if err != nil {
		t.Fatal(err)
	}
	// HEVC in a browser that can't play it: a transcode through an engine
	// session, with its playlist, kept alive by heartbeats.
	p := resp.Msg.Plan
	if p.VersionId != dvVersion || p.Method != apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_VIDEO_TRANSCODE || p.SessionId == "" {
		t.Fatalf("plan %v", p)
	}
	got, err := http.Get(h.url + p.Url)
	if err != nil {
		t.Fatal(err)
	}
	playlist, _ := io.ReadAll(got.Body)
	got.Body.Close()
	if got.StatusCode != http.StatusOK || !strings.HasPrefix(string(playlist), "#EXTM3U") {
		t.Errorf("playlist: %d %s", got.StatusCode, playlist)
	}
	if _, err := client.Heartbeat(ctx, connect.NewRequest(&apiv1alpha.HeartbeatRequest{SessionId: p.SessionId})); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Stop(ctx, connect.NewRequest(&apiv1alpha.StopRequest{SessionId: p.SessionId})); err != nil {
		t.Fatal(err)
	}
	_, err = client.Heartbeat(ctx, connect.NewRequest(&apiv1alpha.HeartbeatRequest{SessionId: p.SessionId}))
	wantCode(t, err, connect.CodeNotFound)

	_, err = client.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: item.String()}))
	wantCode(t, err, connect.CodeInvalidArgument)
	_, err = client.Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: uuid.Must(uuid.NewV7()).String(), Capabilities: browserCaps()}))
	wantCode(t, err, connect.CodeNotFound)
	_, err = apiv1alpha.NewPlaybackClient(http.DefaultClient, h.url).Start(ctx, connect.NewRequest(&apiv1alpha.StartRequest{ItemId: item.String(), Capabilities: browserCaps()}))
	wantCode(t, err, connect.CodeUnauthenticated)
}
