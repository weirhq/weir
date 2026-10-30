package library

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"

	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const probeTimeout = time.Minute

var (
	videoExts = extSet("mkv mp4 m4v mov avi webm ts m2ts mts wmv mpg mpeg ogv")
	audioExts = extSet("flac mp3 m4a aac ogg oga opus wav aif aiff wv ape dsf mka")

	// Folders that hold extras, samples or NAS housekeeping, never the
	// library itself. Compared lowercased.
	ignoredDirs = map[string]bool{
		"extras": true, "featurettes": true, "behind the scenes": true, "deleted scenes": true,
		"interviews": true, "scenes": true, "shorts": true, "trailers": true, "sample": true,
		"samples": true, "@eadir": true, "#recycle": true, "$recycle.bin": true, "lost+found": true,
	}
)

func extSet(exts string) map[string]bool {
	set := map[string]bool{}
	for _, e := range strings.Fields(exts) {
		set["."+e] = true
	}
	return set
}

// Prober is the part of the engine client a scan needs.
type Prober interface {
	Probe(ctx context.Context, in *enginev1alpha.ProbeRequest, opts ...grpc.CallOption) (*enginev1alpha.ProbeResponse, error)
}

// Scanner brings a library's items in line with its folders.
type Scanner struct {
	store  *store.Store
	engine Prober
}

func NewScanner(st *store.Store, engine Prober) *Scanner {
	return &Scanner{store: st, engine: engine}
}

// Result counts what a scan did with each file.
type Result struct {
	Added, Updated, Unchanged, Removed int
	// Stored but not placed under any item.
	Unmatched int
	// The engine couldn't read them; they'll be retried next scan.
	Failed int
}

// ErrNoLibrary means the library was deleted before its scan ran.
var ErrNoLibrary = errors.New("library no longer exists")

// Scan walks every folder of the library. Files that disappeared are removed,
// except under a folder that is missing altogether: an unmounted disk must
// not empty the library.
func (s *Scanner) Scan(ctx context.Context, libraryID uuid.UUID) (Result, error) {
	var res Result
	lib, err := s.store.GetLibrary(ctx, libraryID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return res, ErrNoLibrary
		}
		return res, err
	}
	paths, err := s.store.ListLibraryPaths(ctx, []uuid.UUID{libraryID})
	if err != nil {
		return res, err
	}
	known, err := s.store.ListMediaFiles(ctx, libraryID)
	if err != nil {
		return res, err
	}

	exts := videoExts
	if Kind(lib.Kind) == Music {
		exts = audioExts
	}
	seen := map[string]bool{}
	var offline []string
	for _, p := range paths {
		root := p.Path
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			slog.WarnContext(ctx, "library folder unavailable; keeping its files", "library", lib.Name, "path", root, "err", err)
			offline = append(offline, root)
			continue
		}
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				slog.WarnContext(ctx, "skipping unreadable path", "path", path, "err", err)
				return nil
			}
			name := d.Name()
			if path != root && strings.HasPrefix(name, ".") {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				if path != root && ignoredDirs[strings.ToLower(name)] {
					return fs.SkipDir
				}
				return nil
			}
			if !d.Type().IsRegular() || !exts[strings.ToLower(filepath.Ext(name))] {
				return nil
			}
			seen[path] = true
			return s.scanFile(ctx, lib, root, path, d, &res)
		})
		if err != nil {
			return res, err
		}
	}

	for _, f := range known {
		if seen[f.Path] || underAny(f.Path, offline) {
			continue
		}
		if err := s.store.DeleteMediaFile(ctx, f.ID); err != nil {
			return res, err
		}
		res.Removed++
	}
	for {
		n, err := s.store.PruneEmptyItems(ctx, libraryID)
		if err != nil {
			return res, err
		}
		if n == 0 {
			break
		}
	}
	return res, nil
}

func (s *Scanner) scanFile(ctx context.Context, lib dbgen.Library, root, path string, d fs.DirEntry, res *Result) error {
	info, err := d.Info()
	if err != nil {
		slog.WarnContext(ctx, "skipping unreadable file", "path", path, "err", err)
		return nil
	}
	// Postgres keeps microseconds.
	modified := info.ModTime().Truncate(time.Microsecond)
	existing, err := s.store.GetMediaFileByPath(ctx, path)
	switch {
	case err == nil && existing.SizeBytes == info.Size() && existing.ModifiedAt.Equal(modified):
		res.Unchanged++
		return nil
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return err
	}
	isNew := err != nil

	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	probe, err := s.engine.Probe(probeCtx, &enginev1alpha.ProbeRequest{Path: path})
	cancel()
	if err != nil {
		if code := status.Code(err); code == codes.Unavailable || code == codes.Canceled {
			// The engine is down: fail the whole scan so it's retried.
			return fmt.Errorf("probe %s: %w", path, err)
		}
		slog.WarnContext(ctx, "engine could not read file", "path", path, "err", err)
		res.Failed++
		return nil
	}
	probeJSON, err := protojson.Marshal(probe)
	if err != nil {
		return err
	}

	match, matched := MatchFile(Kind(lib.Kind), root, path, probe.GetTags())
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		if !isNew {
			// Re-match from scratch: new tags or a new name can move it.
			if err := q.DeleteMediaFile(ctx, existing.ID); err != nil {
				return err
			}
		}
		var versionID *uuid.UUID
		if matched {
			id, err := s.placeVersion(ctx, q, lib.ID, match)
			if err != nil {
				return err
			}
			versionID = &id
		}
		fileID := uuid.Must(uuid.NewV7())
		var durationMs *int64
		if d := probe.GetDuration(); d != nil {
			ms := d.AsDuration().Milliseconds()
			durationMs = &ms
		}
		if err := q.InsertMediaFile(ctx, dbgen.InsertMediaFileParams{
			ID:         fileID,
			LibraryID:  lib.ID,
			VersionID:  versionID,
			Path:       path,
			SizeBytes:  info.Size(),
			ModifiedAt: modified,
			Container:  probe.GetContainer(),
			DurationMs: durationMs,
			ProbeHash:  probe.GetProbeHash(),
			Probe:      probeJSON,
		}); err != nil {
			return err
		}
		_, err := q.InsertStreams(ctx, streamRows(fileID, probe))
		return err
	})
	if err != nil {
		return fmt.Errorf("store %s: %w", path, err)
	}
	switch {
	case !matched:
		res.Unmatched++
	case isNew:
		res.Added++
	default:
		res.Updated++
	}
	return nil
}

// placeVersion finds or creates each item in the match, top down, and adds
// a version to the last.
func (s *Scanner) placeVersion(ctx context.Context, q *dbgen.Queries, libraryID uuid.UUID, m Match) (uuid.UUID, error) {
	var parent *uuid.UUID
	for _, it := range m.Items {
		id, err := q.UpsertItem(ctx, dbgen.UpsertItemParams{
			ID:          uuid.Must(uuid.NewV7()),
			LibraryID:   libraryID,
			Kind:        it.Kind,
			ParentID:    parent,
			Title:       it.Title,
			SortTitle:   it.SortTitle,
			Year:        optional(it.Year),
			IndexNumber: optional(it.Index),
			DiscNumber:  optional(it.Disc),
			MatchKey:    it.Key,
		})
		if err != nil {
			return uuid.Nil, err
		}
		parent = &id
	}
	versionID := uuid.Must(uuid.NewV7())
	err := q.CreateVersion(ctx, dbgen.CreateVersionParams{ID: versionID, ItemID: *parent, Edition: m.Edition})
	return versionID, err
}

func streamRows(fileID uuid.UUID, probe *enginev1alpha.ProbeResponse) []dbgen.InsertStreamsParams {
	rows := make([]dbgen.InsertStreamsParams, 0, len(probe.GetStreams()))
	for _, st := range probe.GetStreams() {
		row := dbgen.InsertStreamsParams{
			MediaFileID: fileID,
			Index:       int32(st.GetIndex()),
			Kind:        streamKind(st.GetKind()),
			Codec:       st.GetCodec(),
			Profile:     st.GetProfile(),
			Language:    st.GetLanguage(),
			Title:       st.GetTitle(),
			IsDefault:   st.GetFlags().GetDefault(),
			IsForced:    st.GetFlags().GetForced(),
		}
		if v := st.GetVideo(); v != nil {
			hdr := hdrFormat(v.GetHdrFormat())
			row.HdrFormat = &hdr
			row.Width = optional(int(v.GetWidth()))
			row.Height = optional(int(v.GetHeight()))
		}
		if a := st.GetAudio(); a != nil {
			row.Channels = optional(int(a.GetChannels()))
		}
		rows = append(rows, row)
	}
	return rows
}

func streamKind(k enginev1alpha.StreamKind) string {
	switch k {
	case enginev1alpha.StreamKind_STREAM_KIND_VIDEO:
		return "video"
	case enginev1alpha.StreamKind_STREAM_KIND_AUDIO:
		return "audio"
	case enginev1alpha.StreamKind_STREAM_KIND_SUBTITLE:
		return "subtitle"
	}
	return "data"
}

func hdrFormat(f enginev1alpha.HdrFormat) string {
	switch f {
	case enginev1alpha.HdrFormat_HDR_FORMAT_HDR10:
		return "hdr10"
	case enginev1alpha.HdrFormat_HDR_FORMAT_HDR10_PLUS:
		return "hdr10plus"
	case enginev1alpha.HdrFormat_HDR_FORMAT_HLG:
		return "hlg"
	case enginev1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION:
		return "dv"
	}
	return "sdr"
}

func optional(n int) *int32 {
	if n == 0 {
		return nil
	}
	v := int32(n)
	return &v
}

// underAny reports whether path is inside one of dirs.
func underAny(path string, dirs []string) bool {
	for _, d := range dirs {
		if rel, err := filepath.Rel(d, path); err == nil && !strings.HasPrefix(rel, "..") {
			return true
		}
	}
	return false
}
