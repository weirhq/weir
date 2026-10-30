package admin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/library"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const maxLibraryNameLength = 128

var errLibraryNotFound = connect.NewError(connect.CodeNotFound, errors.New("no such library"))

func (s *Service) ListLibraries(ctx context.Context, _ *connect.Request[apiv1alpha.ListLibrariesRequest]) (*connect.Response[apiv1alpha.ListLibrariesResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	libs, err := s.store.ListLibraries(ctx)
	if err != nil {
		return nil, auth.Internal(ctx, "list libraries", err)
	}
	paths, err := s.libraryPaths(ctx, libs)
	if err != nil {
		return nil, auth.Internal(ctx, "list library paths", err)
	}
	resp := &apiv1alpha.ListLibrariesResponse{}
	for _, l := range libs {
		resp.Libraries = append(resp.Libraries, libraryToProto(l, paths[l.ID]))
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) CreateLibrary(ctx context.Context, req *connect.Request[apiv1alpha.CreateLibraryRequest]) (*connect.Response[apiv1alpha.CreateLibraryResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	msg := req.Msg
	kind, kindErr := libraryKindFromProto(msg.Kind)
	paths, pathsErr := s.validatePaths(ctx, uuid.Nil, msg.Paths)
	if err := errors.Join(validateLibraryName(msg.Name), kindErr, pathsErr); err != nil {
		return nil, auth.InvalidArgument(err)
	}

	var lib dbgen.Library
	err := s.store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		lib, err = q.CreateLibrary(ctx, dbgen.CreateLibraryParams{ID: uuid.Must(uuid.NewV7()), Name: msg.Name, Kind: string(kind)})
		if err != nil {
			return err
		}
		return addPaths(ctx, q, lib.ID, paths)
	})
	if err != nil {
		return nil, auth.Internal(ctx, "create library", err)
	}
	if err := library.QueueScan(ctx, s.jobs, lib.ID); err != nil {
		return nil, auth.Internal(ctx, "queue scan", err)
	}
	return connect.NewResponse(&apiv1alpha.CreateLibraryResponse{Library: libraryToProto(lib, paths)}), nil
}

func (s *Service) UpdateLibrary(ctx context.Context, req *connect.Request[apiv1alpha.UpdateLibraryRequest]) (*connect.Response[apiv1alpha.UpdateLibraryResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	msg := req.Msg
	id, err := uuid.Parse(msg.Id)
	if err != nil {
		return nil, errLibraryNotFound
	}
	mask := msg.GetUpdateMask().GetPaths()
	if len(mask) == 0 {
		return nil, auth.InvalidArgument(errors.New("update_mask names no fields"))
	}
	var setName, setPaths bool
	var paths []string
	for _, p := range mask {
		switch p {
		case "name":
			setName = true
			if err := validateLibraryName(msg.Name); err != nil {
				return nil, auth.InvalidArgument(err)
			}
		case "paths":
			setPaths = true
			if paths, err = s.validatePaths(ctx, id, msg.Paths); err != nil {
				return nil, auth.InvalidArgument(err)
			}
		default:
			return nil, auth.InvalidArgument(fmt.Errorf("update_mask: unknown field %q", p))
		}
	}

	var lib dbgen.Library
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		if lib, err = q.GetLibrary(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			return errLibraryNotFound
		} else if err != nil {
			return err
		}
		if setName {
			if lib, err = q.RenameLibrary(ctx, dbgen.RenameLibraryParams{ID: id, Name: msg.Name}); err != nil {
				return err
			}
		}
		if setPaths {
			if err := q.ClearLibraryPaths(ctx, id); err != nil {
				return err
			}
			return addPaths(ctx, q, id, paths)
		}
		return nil
	})
	if err != nil {
		return nil, auth.ConnectOrInternal(ctx, "update library", err)
	}
	if setPaths {
		// The scan picks up new folders and drops files from removed ones.
		if err := library.QueueScan(ctx, s.jobs, id); err != nil {
			return nil, auth.Internal(ctx, "queue scan", err)
		}
	}
	all, err := s.libraryPaths(ctx, []dbgen.Library{lib})
	if err != nil {
		return nil, auth.Internal(ctx, "list library paths", err)
	}
	return connect.NewResponse(&apiv1alpha.UpdateLibraryResponse{Library: libraryToProto(lib, all[id])}), nil
}

func (s *Service) DeleteLibrary(ctx context.Context, req *connect.Request[apiv1alpha.DeleteLibraryRequest]) (*connect.Response[apiv1alpha.DeleteLibraryResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, errLibraryNotFound
	}
	n, err := s.store.DeleteLibrary(ctx, id)
	if err != nil {
		return nil, auth.Internal(ctx, "delete library", err)
	}
	if n == 0 {
		return nil, errLibraryNotFound
	}
	return connect.NewResponse(&apiv1alpha.DeleteLibraryResponse{}), nil
}

func (s *Service) ScanLibrary(ctx context.Context, req *connect.Request[apiv1alpha.ScanLibraryRequest]) (*connect.Response[apiv1alpha.ScanLibraryResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, errLibraryNotFound
	}
	if _, err := s.store.GetLibrary(ctx, id); errors.Is(err, pgx.ErrNoRows) {
		return nil, errLibraryNotFound
	} else if err != nil {
		return nil, auth.Internal(ctx, "load library", err)
	}
	if err := library.QueueScan(ctx, s.jobs, id); err != nil {
		return nil, auth.Internal(ctx, "queue scan", err)
	}
	return connect.NewResponse(&apiv1alpha.ScanLibraryResponse{}), nil
}

// validatePaths cleans and checks a library's folders: absolute, existing
// directories under one of the server's library_paths, and not overlapping
// another library's (a file belongs to one library). self is the library
// being edited, or uuid.Nil for a new one.
func (s *Service) validatePaths(ctx context.Context, self uuid.UUID, paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, errors.New("a library needs at least one folder")
	}
	others, err := s.store.ListAllLibraryPaths(ctx)
	if err != nil {
		return nil, err
	}
	var clean []string
	var errs []error
	for _, p := range paths {
		if !filepath.IsAbs(p) {
			errs = append(errs, fmt.Errorf("%q is not an absolute path", p))
			continue
		}
		p = filepath.Clean(p)
		if !slices.ContainsFunc(s.roots, func(root string) bool { return within(root, p) }) {
			errs = append(errs, fmt.Errorf("%s is outside the server's library_paths (%s)", p, strings.Join(s.roots, ", ")))
			continue
		}
		if info, err := os.Stat(p); err != nil || !info.IsDir() {
			errs = append(errs, fmt.Errorf("%s is not a folder the server can see", p))
			continue
		}
		for _, o := range others {
			if o.LibraryID != self && (within(o.Path, p) || within(p, o.Path)) {
				errs = append(errs, fmt.Errorf("%s overlaps %s, which belongs to another library", p, o.Path))
			}
		}
		for _, c := range clean {
			if within(c, p) || within(p, c) {
				errs = append(errs, fmt.Errorf("%s overlaps %s", p, c))
			}
		}
		clean = append(clean, p)
	}
	return clean, errors.Join(errs...)
}

func (s *Service) libraryPaths(ctx context.Context, libs []dbgen.Library) (map[uuid.UUID][]string, error) {
	ids := make([]uuid.UUID, len(libs))
	for i, l := range libs {
		ids[i] = l.ID
	}
	rows, err := s.store.ListLibraryPaths(ctx, ids)
	if err != nil {
		return nil, err
	}
	paths := map[uuid.UUID][]string{}
	for _, r := range rows {
		paths[r.LibraryID] = append(paths[r.LibraryID], r.Path)
	}
	return paths, nil
}

func addPaths(ctx context.Context, q *dbgen.Queries, id uuid.UUID, paths []string) error {
	for _, p := range paths {
		if err := q.AddLibraryPath(ctx, dbgen.AddLibraryPathParams{LibraryID: id, Path: p}); err != nil {
			return err
		}
	}
	return nil
}

// within reports whether path is dir or inside it.
func within(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, "../")
}

func validateLibraryName(name string) error {
	if n := utf8.RuneCountInString(strings.TrimSpace(name)); n == 0 || n > maxLibraryNameLength {
		return fmt.Errorf("library name must be 1 to %d characters", maxLibraryNameLength)
	}
	return nil
}

func libraryKindFromProto(k apiv1alpha.LibraryKind) (library.Kind, error) {
	switch k {
	case apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES:
		return library.Movies, nil
	case apiv1alpha.LibraryKind_LIBRARY_KIND_SHOWS:
		return library.Shows, nil
	case apiv1alpha.LibraryKind_LIBRARY_KIND_MUSIC:
		return library.Music, nil
	}
	return "", errors.New("library kind must be movies, shows or music")
}

func libraryToProto(l dbgen.Library, paths []string) *apiv1alpha.Library {
	kind := map[library.Kind]apiv1alpha.LibraryKind{
		library.Movies: apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES,
		library.Shows:  apiv1alpha.LibraryKind_LIBRARY_KIND_SHOWS,
		library.Music:  apiv1alpha.LibraryKind_LIBRARY_KIND_MUSIC,
	}[library.Kind(l.Kind)]
	return &apiv1alpha.Library{Id: l.ID.String(), Name: l.Name, Kind: kind, Paths: paths}
}
