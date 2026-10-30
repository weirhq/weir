package library_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
	"github.com/weirhq/weir/server/internal/store/storetest"
)

// fakeEngine answers Probe from file names: "broken" in a name is a file
// the engine can't read, and tags come from the tags map by base name.
type fakeEngine struct {
	down   bool
	tags   map[string]map[string]string
	probes int
}

func (f *fakeEngine) Probe(_ context.Context, req *enginev1alpha.ProbeRequest, _ ...grpc.CallOption) (*enginev1alpha.ProbeResponse, error) {
	f.probes++
	if f.down {
		return nil, status.Error(codes.Unavailable, "engine not running")
	}
	if strings.Contains(strings.ToLower(req.Path), "broken") {
		return nil, status.Error(codes.FailedPrecondition, "ffprobe could not read it")
	}
	return &enginev1alpha.ProbeResponse{
		ProbeHash: "hash-" + filepath.Base(req.Path),
		Container: "matroska,webm",
		Tags:      f.tags[filepath.Base(req.Path)],
		Streams: []*enginev1alpha.Stream{
			{Index: 0, Kind: enginev1alpha.StreamKind_STREAM_KIND_VIDEO, Codec: "hevc",
				Detail: &enginev1alpha.Stream_Video{Video: &enginev1alpha.VideoDetail{Width: 3840, Height: 2160, HdrFormat: enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION}}},
			{Index: 1, Kind: enginev1alpha.StreamKind_STREAM_KIND_AUDIO, Codec: "truehd", Language: "en",
				Detail: &enginev1alpha.Stream_Audio{Audio: &enginev1alpha.AudioDetail{Channels: 8}}},
		},
	}, nil
}

type fixture struct {
	t       *testing.T
	st      *store.Store
	engine  *fakeEngine
	scanner *library.Scanner
	root    string
	lib     uuid.UUID
}

func newFixture(t *testing.T, kind library.Kind) *fixture {
	t.Helper()
	st := storetest.New(t)
	f := &fixture{t: t, st: st, engine: &fakeEngine{}, root: t.TempDir(), lib: uuid.Must(uuid.NewV7())}
	f.scanner = library.NewScanner(st, f.engine)
	ctx := context.Background()
	if _, err := st.CreateLibrary(ctx, dbgen.CreateLibraryParams{ID: f.lib, Name: "Test", Kind: string(kind)}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddLibraryPath(ctx, dbgen.AddLibraryPathParams{LibraryID: f.lib, Path: f.root}); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) write(rel string) {
	f.t.Helper()
	p := filepath.Join(f.root, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(rel), 0o644); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) scan() library.Result {
	f.t.Helper()
	res, err := f.scanner.Scan(context.Background(), f.lib)
	if err != nil {
		f.t.Fatal(err)
	}
	return res
}

func (f *fixture) count(query string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.st.Pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *fixture) items(kind string) int {
	return f.count("SELECT count(*) FROM item WHERE library_id = $1 AND kind = $2", f.lib, kind)
}

func TestScanMovies(t *testing.T) {
	f := newFixture(t, library.Movies)
	f.write("Blade Runner (1982)/Blade Runner (1982).mkv")
	f.write("Blade Runner (1982)/Blade Runner (1982) - Final Cut.mkv")
	f.write("Arrival (2016)/Arrival (2016).mp4")
	f.write("Arrival (2016)/Arrival (2016).nfo")
	f.write("Arrival (2016)/Extras/Making Of.mkv")
	f.write(".hidden/Secret (2000).mkv")
	f.write("Broken (2001).mkv")

	res := f.scan()
	if res.Added != 3 || res.Failed != 1 {
		t.Fatalf("first scan: %+v", res)
	}
	if n := f.items("movie"); n != 2 {
		t.Errorf("%d movies, want 2", n)
	}
	if n := f.count(`SELECT count(*) FROM version v JOIN item i ON i.id = v.item_id WHERE i.title = 'Blade Runner'`); n != 2 {
		t.Errorf("Blade Runner has %d versions, want 2", n)
	}
	if n := f.count(`SELECT count(*) FROM version WHERE edition = 'Final Cut'`); n != 1 {
		t.Error("no Final Cut version")
	}
	if n := f.count(`SELECT count(*) FROM stream WHERE hdr_format = 'dv' AND width = 3840`); n != 3 {
		t.Errorf("%d DV video streams, want 3", n)
	}

	// Nothing changed: nothing is probed again.
	probes := f.engine.probes
	if res := f.scan(); res.Unchanged != 3 || res.Added+res.Updated+res.Removed != 0 {
		t.Errorf("rescan: %+v", res)
	}
	if f.engine.probes != probes+1 { // only the broken file is retried
		t.Errorf("rescan probed %d files, want 1", f.engine.probes-probes)
	}

	// A changed file is probed and re-matched; a deleted one goes, with any
	// item it leaves empty.
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(filepath.Join(f.root, "Arrival (2016)/Arrival (2016).mp4"), later, later); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(f.root, "Blade Runner (1982)")); err != nil {
		t.Fatal(err)
	}
	res = f.scan()
	if res.Updated != 1 || res.Removed != 2 {
		t.Errorf("after edits: %+v", res)
	}
	if n := f.items("movie"); n != 1 {
		t.Errorf("%d movies left, want 1", n)
	}
	if n := f.count("SELECT count(*) FROM version"); n != 1 {
		t.Errorf("%d versions left, want 1", n)
	}
}

func TestScanKeepsFilesFromAnOfflineFolder(t *testing.T) {
	f := newFixture(t, library.Movies)
	f.write("Arrival (2016).mkv")
	f.scan()

	// The disk is unmounted: the folder itself is gone.
	if err := os.RemoveAll(f.root); err != nil {
		t.Fatal(err)
	}
	if res := f.scan(); res.Removed != 0 {
		t.Errorf("removed %d files from an offline folder", res.Removed)
	}
	if n := f.items("movie"); n != 1 {
		t.Errorf("%d movies, want 1", n)
	}
}

func TestScanFailsWhileTheEngineIsDown(t *testing.T) {
	f := newFixture(t, library.Movies)
	f.write("Arrival (2016).mkv")
	f.engine.down = true
	if _, err := f.scanner.Scan(context.Background(), f.lib); err == nil {
		t.Fatal("scan succeeded with the engine down")
	}
	if n := f.count("SELECT count(*) FROM media_file"); n != 0 {
		t.Errorf("stored %d files without probing them", n)
	}
}

func TestScanShows(t *testing.T) {
	f := newFixture(t, library.Shows)
	f.write("Severance (2022)/Season 01/Severance - S01E01 - Good News About Hell.mkv")
	f.write("Severance (2022)/Season 01/Severance - S01E02 - Half Loop.mkv")
	f.write("Severance (2022)/Season 02/Severance - S02E01 - Hello, Ms. Cobel.mkv")
	f.write("Severance (2022)/trailer.mkv")

	res := f.scan()
	if res.Added != 3 || res.Unmatched != 1 {
		t.Fatalf("scan: %+v", res)
	}
	for kind, want := range map[string]int{"show": 1, "season": 2, "episode": 3} {
		if n := f.items(kind); n != want {
			t.Errorf("%d %ss, want %d", n, kind, want)
		}
	}
	if n := f.count(`SELECT count(*) FROM item e JOIN item s ON s.id = e.parent_id
		WHERE e.kind = 'episode' AND s.index_number = 1`); n != 2 {
		t.Errorf("season 1 has %d episodes, want 2", n)
	}
}

func TestScanMusicUsesTags(t *testing.T) {
	f := newFixture(t, library.Music)
	f.engine.tags = map[string]map[string]string{
		"a.flac": {"album_artist": "Kate Bush", "album": "Hounds of Love", "title": "Running Up That Hill", "track": "1"},
		"b.flac": {"album_artist": "Kate Bush", "album": "Hounds of Love", "title": "Hounds of Love", "track": "2"},
	}
	f.write("incoming/a.flac")
	f.write("incoming/b.flac")
	f.write("Massive Attack/Mezzanine (1998)/01 - Angel.flac")
	f.write("Massive Attack/Mezzanine (1998)/cover.jpg")

	if res := f.scan(); res.Added != 3 {
		t.Fatalf("scan: %+v", res)
	}
	for kind, want := range map[string]int{"artist": 2, "album": 2, "track": 3} {
		if n := f.items(kind); n != want {
			t.Errorf("%d %ss, want %d", n, kind, want)
		}
	}
	if n := f.count(`SELECT count(*) FROM item WHERE kind = 'album' AND title = 'Mezzanine' AND year = 1998`); n != 1 {
		t.Error("Mezzanine has no year from its folder")
	}
}

func TestScanOfDeletedLibrary(t *testing.T) {
	f := newFixture(t, library.Movies)
	if _, err := f.scanner.Scan(context.Background(), uuid.Must(uuid.NewV7())); err != library.ErrNoLibrary {
		t.Fatalf("got %v, want ErrNoLibrary", err)
	}
}
