package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// Refresher fills in metadata for a library's items. Online providers are
// nil when not configured.
type Refresher struct {
	store       *store.Store
	tmdb        *TMDB
	musicBrainz *MusicBrainz
}

func NewRefresher(st *store.Store, tmdb *TMDB, musicBrainz *MusicBrainz) *Refresher {
	return &Refresher{store: st, tmdb: tmdb, musicBrainz: musicBrainz}
}

// Stats counts what a refresh did.
type Stats struct {
	Items, Failed int
}

// RefreshLibrary looks up every top-level item that hasn't been looked up in
// the last month. One item failing doesn't stop the rest.
func (r *Refresher) RefreshLibrary(ctx context.Context, libraryID uuid.UUID) (Stats, error) {
	var stats Stats
	paths, err := r.store.ListLibraryPaths(ctx, []uuid.UUID{libraryID})
	if err != nil {
		return stats, err
	}
	var roots []string
	for _, p := range paths {
		roots = append(roots, p.Path)
	}
	items, err := r.store.ItemsNeedingMetadata(ctx, libraryID)
	if err != nil {
		return stats, err
	}
	// A provider that rejects its key is dropped for the rest of the run.
	run := *r
	for _, it := range items {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		err := run.refreshItem(ctx, roots, it)
		switch {
		case errors.Is(err, ErrUnauthorized):
			slog.ErrorContext(ctx, "metadata provider rejected its key; check the metadata settings", "item", it.Title, "err", err)
			run.drop(err)
			stats.Failed++
		case err != nil:
			slog.WarnContext(ctx, "metadata lookup failed", "item", it.Title, "kind", it.Kind, "err", err)
			stats.Failed++
		}
		if err := r.store.RecordMetadataAttempt(ctx, it.ID); err != nil {
			return stats, err
		}
		stats.Items++
	}
	return stats, nil
}

// unauthorizedError tags ErrUnauthorized with the provider it came from.
type unauthorizedError struct{ source string }

func (e unauthorizedError) Error() string { return e.source + ": " + ErrUnauthorized.Error() }
func (e unauthorizedError) Unwrap() error { return ErrUnauthorized }

func (r *Refresher) drop(err error) {
	var u unauthorizedError
	if errors.As(err, &u) {
		switch u.source {
		case SourceTMDB:
			r.tmdb = nil
		case SourceMusicBrainz:
			r.musicBrainz = nil
		}
	}
}

func provider(source string, err error) error {
	if errors.Is(err, ErrUnauthorized) {
		return unauthorizedError{source}
	}
	return err
}

func (r *Refresher) refreshItem(ctx context.Context, roots []string, it dbgen.ItemsNeedingMetadataRow) error {
	files, err := r.store.ItemFilePaths(ctx, it.ID)
	if err != nil || len(files) == 0 {
		return err
	}
	item, err := r.store.GetItem(ctx, it.ID)
	if err != nil {
		return err
	}
	var ids map[string]string
	_ = json.Unmarshal(item.ExternalIds, &ids)
	switch it.Kind {
	case "movie":
		return r.refreshMovie(ctx, roots, item, ids, files[0].Path)
	case "show":
		return r.refreshShow(ctx, roots, item, ids, files[0].Path)
	case "artist":
		return r.refreshArtist(ctx, item, files)
	case "album":
		return r.refreshAlbum(ctx, roots, item, files)
	}
	return nil
}

func (r *Refresher) refreshMovie(ctx context.Context, roots []string, item dbgen.Item, ids map[string]string, file string) error {
	dir := filepath.Dir(file)
	ownFolder := !isRoot(dir, roots)
	stem := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	nfoPaths := []string{filepath.Join(dir, stem+".nfo")}
	if ownFolder {
		nfoPaths = append(nfoPaths, filepath.Join(dir, "movie.nfo"))
	}
	if rec, ok := readNFO("movie", nfoPaths...); ok {
		if err := saveRecord(ctx, r.store.Queries, item.ID, SourceNFO, rec); err != nil {
			return err
		}
		ids = merge(ids, rec.ExternalIDs)
	}
	if err := saveArt(ctx, r.store.Queries, item.ID, movieArt(file, ownFolder)); err != nil {
		return err
	}
	if r.tmdb == nil {
		return nil
	}
	rec, art, err := r.tmdb.Movie(ctx, item.Title, int(deref(item.Year)), ids)
	if errors.Is(err, errNotFound) {
		return nil
	}
	if err != nil {
		return provider(SourceTMDB, err)
	}
	return r.save(ctx, item.ID, SourceTMDB, rec, art)
}

func (r *Refresher) refreshShow(ctx context.Context, roots []string, show dbgen.Item, ids map[string]string, file string) error {
	showDir := showFolder(file, roots)
	if showDir != "" {
		if rec, ok := readNFO("tvshow", filepath.Join(showDir, "tvshow.nfo")); ok {
			if err := saveRecord(ctx, r.store.Queries, show.ID, SourceNFO, rec); err != nil {
				return err
			}
			ids = merge(ids, rec.ExternalIDs)
		}
		if err := saveArt(ctx, r.store.Queries, show.ID, folderArt(showDir, "poster", "folder")); err != nil {
			return err
		}
	}

	var tmdbID string
	if r.tmdb != nil {
		rec, art, id, err := r.tmdb.Show(ctx, show.Title, int(deref(show.Year)), ids)
		switch {
		case errors.Is(err, errNotFound):
		case err != nil:
			return provider(SourceTMDB, err)
		default:
			if err := r.save(ctx, show.ID, SourceTMDB, rec, art); err != nil {
				return err
			}
			tmdbID = id
		}
	}

	seasons, err := r.store.ChildItems(ctx, show.ID)
	if err != nil {
		return err
	}
	for _, season := range seasons {
		if err := r.refreshSeason(ctx, showDir, tmdbID, season); err != nil {
			return err
		}
	}
	return nil
}

func (r *Refresher) refreshSeason(ctx context.Context, showDir, tmdbID string, season dbgen.ChildItemsRow) error {
	number := int(deref(season.IndexNumber))
	episodes, err := r.store.ChildItems(ctx, season.ID)
	if err != nil {
		return err
	}
	var seasonDir string
	for _, ep := range episodes {
		files, err := r.store.ItemFilePaths(ctx, ep.ID)
		if err != nil {
			return err
		}
		if len(files) == 0 {
			continue
		}
		file := files[0].Path
		seasonDir = filepath.Dir(file)
		stem := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
		if rec, ok := readNFO("episodedetails", filepath.Join(seasonDir, stem+".nfo")); ok {
			if err := saveRecord(ctx, r.store.Queries, ep.ID, SourceNFO, rec); err != nil {
				return err
			}
		}
		if err := saveArt(ctx, r.store.Queries, ep.ID, episodeThumb(file)); err != nil {
			return err
		}
	}
	if showDir != "" {
		if err := saveArt(ctx, r.store.Queries, season.ID, seasonPoster(showDir, seasonDir, number)); err != nil {
			return err
		}
	}
	if tmdbID == "" {
		return nil
	}
	rec, art, tmdbEpisodes, err := r.tmdb.Season(ctx, tmdbID, number)
	if errors.Is(err, errNotFound) {
		return nil
	}
	if err != nil {
		return provider(SourceTMDB, err)
	}
	if err := r.save(ctx, season.ID, SourceTMDB, rec, art); err != nil {
		return err
	}
	for _, ep := range episodes {
		if e, ok := tmdbEpisodes[int(deref(ep.IndexNumber))]; ok {
			if err := r.save(ctx, ep.ID, SourceTMDB, e.Record, e.Art); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Refresher) refreshArtist(ctx context.Context, artist dbgen.Item, files []dbgen.ItemFilePathsRow) error {
	if r.musicBrainz == nil {
		return nil
	}
	mbid := firstTag(files, "musicbrainz_albumartistid", "musicbrainz_artistid")
	rec, err := r.musicBrainz.Artist(ctx, artist.Title, mbid)
	if errors.Is(err, errNotFound) {
		return nil
	}
	if err != nil {
		return provider(SourceMusicBrainz, err)
	}
	return r.save(ctx, artist.ID, SourceMusicBrainz, rec, nil)
}

func (r *Refresher) refreshAlbum(ctx context.Context, roots []string, album dbgen.Item, files []dbgen.ItemFilePathsRow) error {
	if dir := filepath.Dir(files[0].Path); !isRoot(dir, roots) {
		if err := saveArt(ctx, r.store.Queries, album.ID, folderArt(dir, "cover", "folder", "front", "album")); err != nil {
			return err
		}
	}
	if r.musicBrainz == nil {
		return nil
	}
	var artistName string
	if album.ParentID != nil {
		if artist, err := r.store.GetItem(ctx, *album.ParentID); err == nil {
			artistName = artist.Title
		}
	}
	mbid := firstTag(files, "musicbrainz_releasegroupid")
	rec, art, err := r.musicBrainz.Album(ctx, album.Title, artistName, mbid)
	if errors.Is(err, errNotFound) {
		return nil
	}
	if err != nil {
		return provider(SourceMusicBrainz, err)
	}
	return r.save(ctx, album.ID, SourceMusicBrainz, rec, art)
}

func (r *Refresher) save(ctx context.Context, itemID uuid.UUID, source string, rec Record, art []Art) error {
	return r.store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := saveRecord(ctx, q, itemID, source, rec); err != nil {
			return err
		}
		return saveArt(ctx, q, itemID, art)
	})
}

// firstTag returns the first value of any of keys in the files' probe tags.
// MusicBrainz ids can be lists ("id1/id2"); the first one is the main one.
func firstTag(files []dbgen.ItemFilePathsRow, keys ...string) string {
	for _, f := range files {
		var probe struct {
			Tags map[string]string `json:"tags"`
		}
		if json.Unmarshal(f.Probe, &probe) != nil {
			continue
		}
		for _, k := range keys {
			if v := strings.TrimSpace(probe.Tags[k]); v != "" {
				return strings.TrimSpace(strings.FieldsFunc(v, func(r rune) bool { return r == '/' || r == ';' })[0])
			}
		}
	}
	return ""
}

// showFolder is the folder directly under a library root that holds the
// file, or "" for a file at the top of the library.
func showFolder(file string, roots []string) string {
	for _, root := range roots {
		rel, err := filepath.Rel(root, file)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		if first, _, ok := strings.Cut(filepath.ToSlash(rel), "/"); ok {
			return filepath.Join(root, first)
		}
	}
	return ""
}

func isRoot(dir string, roots []string) bool {
	for _, root := range roots {
		if filepath.Clean(dir) == filepath.Clean(root) {
			return true
		}
	}
	return false
}

func merge(a, b map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func deref(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

// RefreshArgs is the river job that refreshes one library's metadata.
type RefreshArgs struct {
	LibraryID uuid.UUID `json:"library_id"`
}

func (RefreshArgs) Kind() string { return "refresh_metadata" }

// A refresh already waiting or running for the library absorbs a new one.
func (RefreshArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{
		ByArgs: true,
		ByState: []rivertype.JobState{
			rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRetryable,
			rivertype.JobStateRunning, rivertype.JobStateScheduled,
		},
	}}
}

type RefreshWorker struct {
	river.WorkerDefaults[RefreshArgs]
	Refresher *Refresher
}

// Timeout is disabled: MusicBrainz allows one request a second, so a large
// music library takes hours the first time.
func (*RefreshWorker) Timeout(*river.Job[RefreshArgs]) time.Duration { return -1 }

func (w *RefreshWorker) Work(ctx context.Context, job *river.Job[RefreshArgs]) error {
	started := time.Now()
	stats, err := w.Refresher.RefreshLibrary(ctx, job.Args.LibraryID)
	if err != nil {
		return err
	}
	slog.InfoContext(ctx, "metadata refreshed", "library", job.Args.LibraryID,
		"took", time.Since(started).Round(time.Millisecond), "items", stats.Items, "failed", stats.Failed)
	return nil
}
