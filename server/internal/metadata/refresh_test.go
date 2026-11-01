package metadata

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
	"github.com/weirhq/weir/server/internal/store/storetest"
)

type tagProber map[string]map[string]string

func (p tagProber) Probe(_ context.Context, req *enginev1alpha.ProbeRequest, _ ...grpc.CallOption) (*enginev1alpha.ProbeResponse, error) {
	return &enginev1alpha.ProbeResponse{ProbeHash: req.Path, Tags: p[filepath.Base(req.Path)]}, nil
}

// coverProber is a tagProber whose files in covers carry cover art at that
// stream index.
type coverProber struct {
	tagProber
	covers map[string]uint32
}

func (p coverProber) Probe(ctx context.Context, req *enginev1alpha.ProbeRequest, opts ...grpc.CallOption) (*enginev1alpha.ProbeResponse, error) {
	resp, err := p.tagProber.Probe(ctx, req, opts...)
	if i, ok := p.covers[filepath.Base(req.Path)]; ok {
		resp.Attachments = []*enginev1alpha.Attachment{{Index: i, MimeType: "image/jpeg"}}
	}
	return resp, err
}

// scanned creates a library of kind over root and scans it.
func scanned(t *testing.T, st *store.Store, kind library.Kind, root string, tags tagProber) uuid.UUID {
	t.Helper()
	return scannedWith(t, st, kind, root, tags)
}

func scannedWith(t *testing.T, st *store.Store, kind library.Kind, root string, prober library.Prober) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	id := uuid.Must(uuid.NewV7())
	if _, err := st.CreateLibrary(ctx, dbgen.CreateLibraryParams{ID: id, Name: string(kind), Kind: string(kind)}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddLibraryPath(ctx, dbgen.AddLibraryPathParams{LibraryID: id, Path: root}); err != nil {
		t.Fatal(err)
	}
	if _, err := library.NewScanner(st, prober).Scan(ctx, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func resolved(t *testing.T, st *store.Store, title string) dbgen.ResolvedMetadatum {
	t.Helper()
	var id uuid.UUID
	if err := st.Pool.QueryRow(context.Background(), "SELECT id FROM item WHERE title = $1", title).Scan(&id); err != nil {
		t.Fatalf("item %q: %v", title, err)
	}
	m, err := st.GetResolvedMetadata(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestRefreshMoviesAndShows(t *testing.T) {
	st := storetest.New(t)
	ctx := context.Background()
	films, tv := t.TempDir(), t.TempDir()
	write(t, filepath.Join(films, "Arrival (2016)", "Arrival (2016).mkv"), "")
	// The NFO's title wins over TMDB's; TMDB fills in what the NFO lacks.
	write(t, filepath.Join(films, "Arrival (2016)", "movie.nfo"), `<movie><title>Arrival (Director's Edit)</title><uniqueid type="tmdb">329865</uniqueid></movie>`)
	write(t, filepath.Join(films, "Arrival (2016)", "poster.jpg"), "")
	write(t, filepath.Join(films, "Unknown Film (1901).mkv"), "")
	write(t, filepath.Join(tv, "Severance (2022)", "Season 01", "Severance - S01E01.mkv"), "")
	write(t, filepath.Join(tv, "Severance (2022)", "Season 01", "Severance - S01E02.mkv"), "")
	write(t, filepath.Join(tv, "Severance (2022)", "folder.jpg"), "")

	movies := scanned(t, st, library.Movies, films, nil)
	shows := scanned(t, st, library.Shows, tv, nil)
	tmdb := testTMDB(t, "k")
	tmdb.region = "US"
	r := NewRefresher(st, tmdb, nil)

	stats, err := r.RefreshLibrary(ctx, movies)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Items != 2 || stats.Failed != 0 {
		t.Errorf("movies: %+v", stats)
	}
	arrival := resolved(t, st, "Arrival")
	if arrival.Title != "Arrival (Director's Edit)" || arrival.Tagline != "Why are they here?" {
		t.Errorf("arrival: title %v tagline %v", arrival.Title, arrival.Tagline)
	}
	if len(arrival.Genres) != 2 || arrival.Genres[0] != "Drama" {
		t.Errorf("genres %v", arrival.Genres)
	}
	var ids map[string]string
	_ = json.Unmarshal(arrival.ExternalIds, &ids)
	if ids["tmdb"] != "329865" || ids["imdb"] != "tt2543164" {
		t.Errorf("ids %v", ids)
	}
	var art int
	_ = st.Pool.QueryRow(ctx, "SELECT count(*) FROM artwork WHERE source IN ('local', 'tmdb')").Scan(&art)
	if art != 3 { // local poster, TMDB poster and backdrop
		t.Errorf("%d artwork rows, want 3", art)
	}

	if _, err := r.RefreshLibrary(ctx, shows); err != nil {
		t.Fatal(err)
	}
	if m := resolved(t, st, "Severance"); m.ContentRating != "TV-MA" {
		t.Errorf("show rating %v", m.ContentRating)
	}
	// Episodes take TMDB's titles; the files only said "Episode 1".
	if m := resolved(t, st, "Episode 1"); m.Title != "Good News About Hell" {
		t.Errorf("episode 1 title %q", m.Title)
	}

	// Looked-up items, found or not, wait a month before the next try.
	stats, err = r.RefreshLibrary(ctx, movies)
	if err != nil || stats.Items != 0 {
		t.Errorf("second refresh: %+v %v", stats, err)
	}
}

// Refreshing before a provider is set up, or with only an NFO to go on,
// doesn't hold items back from the provider once it is.
func TestRefreshLooksUpOnceAProviderIsSetUp(t *testing.T) {
	st := storetest.New(t)
	ctx := context.Background()
	films := t.TempDir()
	write(t, filepath.Join(films, "Arrival (2016)", "Arrival (2016).mkv"), "")
	write(t, filepath.Join(films, "Arrival (2016)", "movie.nfo"), `<movie><uniqueid type="tmdb">329865</uniqueid></movie>`)
	write(t, filepath.Join(films, "Unknown Film (1901).mkv"), "")
	movies := scanned(t, st, library.Movies, films, nil)

	if stats, err := NewRefresher(st, nil, nil).RefreshLibrary(ctx, movies); err != nil || stats.Items != 2 {
		t.Fatalf("local only: %+v %v", stats, err)
	}
	tmdb := testTMDB(t, "k")
	tmdb.region = "US"
	stats, err := NewRefresher(st, tmdb, nil).RefreshLibrary(ctx, movies)
	if err != nil || stats.Items != 2 {
		t.Fatalf("with TMDB: %+v %v", stats, err)
	}
	if m := resolved(t, st, "Arrival"); m.Tagline != "Why are they here?" {
		t.Errorf("TMDB wasn't asked about Arrival: tagline %q", m.Tagline)
	}
}

func TestRefreshDropsAProviderThatRejectsItsKey(t *testing.T) {
	st := storetest.New(t)
	films := t.TempDir()
	write(t, filepath.Join(films, "Arrival (2016).mkv"), "")
	write(t, filepath.Join(films, "Arrival (2016).nfo"), `<movie><plot>From the NFO.</plot></movie>`)
	write(t, filepath.Join(films, "Blade Runner (1982).mkv"), "")
	movies := scanned(t, st, library.Movies, films, nil)

	bad := testTMDB(t, "right")
	bad.key = "wrong"
	r := NewRefresher(st, bad, nil)
	stats, err := r.RefreshLibrary(context.Background(), movies)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Items != 2 || stats.Failed != 1 {
		t.Errorf("stats %+v: the first rejection should drop TMDB for the second film", stats)
	}
	if m := resolved(t, st, "Arrival"); m.Overview != "From the NFO." {
		t.Error("NFO metadata lost when TMDB failed")
	}
}

func TestRefreshMusic(t *testing.T) {
	st := storetest.New(t)
	root := t.TempDir()
	write(t, filepath.Join(root, "Kate Bush", "Hounds of Love", "01.flac"), "")
	write(t, filepath.Join(root, "Kate Bush", "Hounds of Love", "cover.jpg"), "")
	lib := scanned(t, st, library.Music, root, tagProber{
		"01.flac": {"album_artist": "Kate Bush", "album": "Hounds of Love", "title": "Running Up That Hill", "track": "1"},
	})
	if _, err := NewRefresher(st, nil, testMusicBrainz(t)).RefreshLibrary(context.Background(), lib); err != nil {
		t.Fatal(err)
	}
	if m := resolved(t, st, "Hounds of Love"); m.Year != 1985 || len(m.Genres) == 0 {
		t.Errorf("album: %+v", m)
	}
	var art []string
	rows, _ := st.Pool.Query(context.Background(), "SELECT source FROM artwork ORDER BY artwork_priority(source)")
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		art = append(art, s)
	}
	if len(art) != 2 || art[0] != "local" || art[1] != "coverartarchive" {
		t.Errorf("album art sources %v", art)
	}
}

// Albums use their tracks' embedded cover art.
func TestRefreshMusicArtFromFiles(t *testing.T) {
	st := storetest.New(t)
	ctx := context.Background()
	root := t.TempDir()
	track := filepath.Join(root, "Kate Bush", "Hounds of Love", "01.flac")
	write(t, track, "")
	lib := scannedWith(t, st, library.Music, root, coverProber{
		tagProber: tagProber{"01.flac": {"album_artist": "Kate Bush", "album": "Hounds of Love", "title": "Running Up That Hill", "track": "1"}},
		covers:    map[string]uint32{"01.flac": 1},
	})
	if _, err := NewRefresher(st, nil, nil).RefreshLibrary(ctx, lib); err != nil {
		t.Fatal(err)
	}
	art := map[string]string{}
	rows, err := st.Pool.Query(ctx, "SELECT i.title || ' ' || a.kind || ' ' || a.source, a.location FROM artwork a JOIN item i ON i.id = a.item_id")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var what, location string
		_ = rows.Scan(&what, &location)
		art[what] = location
	}
	want := map[string]string{
		"Hounds of Love poster embedded": track + "#1",
	}
	if len(art) != len(want) {
		t.Errorf("artwork %v, want %v", art, want)
	}
	for k, v := range want {
		if art[k] != v {
			t.Errorf("%s: %q, want %q", k, art[k], v)
		}
	}
}
