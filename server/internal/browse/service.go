// Package browse implements weir.api.v1alpha.Browse: listing, viewing and
// searching what the caller may see.
package browse

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/access"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const (
	defaultPageSize = 100
	maxPageSize     = 500
	defaultResults  = 20
	maxResults      = 100
)

type Service struct {
	// RPCs not implemented yet answer Unimplemented.
	apiv1alpha.UnimplementedBrowseHandler
	store *store.Store
}

func NewService(st *store.Store) *Service { return &Service{store: st} }

var _ apiv1alpha.BrowseHandler = (*Service)(nil)

func (s *Service) ListVisibleLibraries(ctx context.Context, _ *connect.Request[apiv1alpha.ListVisibleLibrariesRequest]) (*connect.Response[apiv1alpha.ListVisibleLibrariesResponse], error) {
	caller, err := access.Load(ctx, s.store)
	if err != nil {
		return nil, err
	}
	libs, err := s.store.ListLibraries(ctx)
	if err != nil {
		return nil, auth.Internal(ctx, "list libraries", err)
	}
	resp := &apiv1alpha.ListVisibleLibrariesResponse{}
	for _, l := range libs {
		if caller.In(l.ID).View {
			// Folder paths are for admins; members only need the name.
			resp.Libraries = append(resp.Libraries, &apiv1alpha.Library{Id: l.ID.String(), Name: l.Name, Kind: libraryKind(l.Kind)})
		}
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) ListItems(ctx context.Context, req *connect.Request[apiv1alpha.ListItemsRequest]) (*connect.Response[apiv1alpha.ListItemsResponse], error) {
	caller, err := access.Load(ctx, s.store)
	if err != nil {
		return nil, err
	}
	msg := req.Msg
	params := dbgen.ListItemsParams{Kinds: []string{}}
	sort := msg.Sort
	switch {
	case msg.LibraryId != "" && msg.ParentId == "":
		id, err := uuid.Parse(msg.LibraryId)
		if err != nil || !caller.In(id).View {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("no such library"))
		}
		params.LibraryID = &id
	case msg.ParentId != "" && msg.LibraryId == "":
		parent, err := s.visibleItem(ctx, caller, msg.ParentId)
		if err != nil {
			return nil, err
		}
		params.ParentID = &parent.ID
		if sort == apiv1alpha.ItemSort_ITEM_SORT_UNSPECIFIED {
			sort = apiv1alpha.ItemSort_ITEM_SORT_INDEX
		}
	default:
		return nil, auth.InvalidArgument(errors.New("give exactly one of library_id and parent_id"))
	}
	for _, k := range msg.Kinds {
		if name, ok := kindNames[k]; ok {
			params.Kinds = append(params.Kinds, name)
		}
	}
	params.Sort = sortNames[sort]
	size := msg.PageSize
	if size == 0 {
		size = defaultPageSize
	}
	params.PageSize = int32(min(size, maxPageSize))
	offset, err := decodeToken(msg.PageToken)
	if err != nil {
		return nil, auth.InvalidArgument(errors.New("invalid page_token"))
	}
	params.PageOffset = int32(offset)

	rows, err := s.store.ListItems(ctx, params)
	if err != nil {
		return nil, auth.Internal(ctx, "list items", err)
	}
	resp := &apiv1alpha.ListItemsResponse{}
	for _, r := range rows {
		resp.Items = append(resp.Items, summary(r.ID, r.Kind, r.Title, r.Year, r.IndexNumber, r.DiscNumber, r.LibraryID, r.ParentID))
		resp.Total = uint32(r.Total)
	}
	if next := offset + len(rows); len(rows) > 0 && uint32(next) < resp.Total {
		resp.NextPageToken = encodeToken(next)
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) GetItem(ctx context.Context, req *connect.Request[apiv1alpha.GetItemRequest]) (*connect.Response[apiv1alpha.GetItemResponse], error) {
	caller, err := access.Load(ctx, s.store)
	if err != nil {
		return nil, err
	}
	it, err := s.visibleItem(ctx, caller, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	m, err := s.store.GetResolvedMetadata(ctx, it.ID)
	if err != nil {
		return nil, auth.Internal(ctx, "load metadata", err)
	}
	item := &apiv1alpha.Item{
		Summary:        summary(it.ID, it.Kind, m.Title, m.Year, it.IndexNumber, it.DiscNumber, it.LibraryID, it.ParentID),
		OriginalTitle:  m.OriginalTitle,
		Overview:       m.Overview,
		Tagline:        m.Tagline,
		ReleaseDate:    m.ReleaseDate,
		RuntimeMinutes: uint32(max(m.RuntimeMinutes, 0)),
		Rating:         m.Rating,
		ContentRating:  m.ContentRating,
		Genres:         m.Genres,
	}
	_ = json.Unmarshal(m.CastMembers, &item.Cast)
	_ = json.Unmarshal(m.ExternalIds, &item.ExternalIds)

	ancestors, err := s.store.ItemAncestors(ctx, it.ID)
	if err != nil {
		return nil, auth.Internal(ctx, "load ancestors", err)
	}
	for _, a := range ancestors {
		item.Ancestors = append(item.Ancestors, summary(a.ID, a.Kind, a.Title, a.Year, a.IndexNumber, a.DiscNumber, a.LibraryID, a.ParentID))
	}
	if item.Versions, err = s.versions(ctx, it.ID); err != nil {
		return nil, auth.Internal(ctx, "load versions", err)
	}
	return connect.NewResponse(&apiv1alpha.GetItemResponse{Item: item}), nil
}

func (s *Service) Search(ctx context.Context, req *connect.Request[apiv1alpha.SearchRequest]) (*connect.Response[apiv1alpha.SearchResponse], error) {
	caller, err := access.Load(ctx, s.store)
	if err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.Msg.Query)
	if query == "" {
		return connect.NewResponse(&apiv1alpha.SearchResponse{}), nil
	}
	libs, err := s.store.ListLibraries(ctx)
	if err != nil {
		return nil, auth.Internal(ctx, "list libraries", err)
	}
	var ids []uuid.UUID
	for _, l := range libs {
		ids = append(ids, l.ID)
	}
	limit := req.Msg.Limit
	if limit == 0 {
		limit = defaultResults
	}
	rows, err := s.store.SearchItems(ctx, dbgen.SearchItemsParams{
		Query: query, LibraryIds: caller.Visible(ids), MaxResults: int32(min(limit, maxResults)),
	})
	if err != nil {
		return nil, auth.Internal(ctx, "search", err)
	}
	resp := &apiv1alpha.SearchResponse{}
	for _, r := range rows {
		resp.Items = append(resp.Items, summary(r.ID, r.Kind, r.Title, r.Year, r.IndexNumber, r.DiscNumber, r.LibraryID, r.ParentID))
	}
	return connect.NewResponse(resp), nil
}

// visibleItem loads an item the caller may view, else NotFound.
func (s *Service) visibleItem(ctx context.Context, caller *access.Caller, id string) (dbgen.Item, error) {
	itemID, err := uuid.Parse(id)
	if err != nil {
		return dbgen.Item{}, access.ErrNotFound
	}
	it, err := s.store.GetItem(ctx, itemID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !caller.In(it.LibraryID).View {
		return dbgen.Item{}, access.ErrNotFound
	}
	if err != nil {
		return dbgen.Item{}, auth.Internal(ctx, "load item", err)
	}
	return it, nil
}

func (s *Service) versions(ctx context.Context, itemID uuid.UUID) ([]*apiv1alpha.Version, error) {
	rows, err := s.store.VersionDetails(ctx, itemID)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	var fileIDs []uuid.UUID
	for _, r := range rows {
		fileIDs = append(fileIDs, r.FileID)
	}
	streams, err := s.store.StreamsForFiles(ctx, fileIDs)
	if err != nil {
		return nil, err
	}
	byFile := map[uuid.UUID][]*apiv1alpha.StreamInfo{}
	for _, st := range streams {
		byFile[st.MediaFileID] = append(byFile[st.MediaFileID], &apiv1alpha.StreamInfo{
			Index: uint32(st.Index), Kind: streamKinds[st.Kind], Codec: st.Codec, Profile: st.Profile,
			Language: st.Language, Title: st.Title, Default: st.IsDefault, Forced: st.IsForced,
			HdrFormat: hdrFormats[deref(st.HdrFormat)],
			Width:     uint32(derefInt(st.Width)), Height: uint32(derefInt(st.Height)), Channels: uint32(derefInt(st.Channels)),
		})
	}
	var out []*apiv1alpha.Version
	for _, r := range rows {
		v := &apiv1alpha.Version{Id: r.VersionID.String(), Edition: r.Edition, Container: r.Container,
			SizeBytes: uint64(r.SizeBytes), Streams: byFile[r.FileID]}
		if r.DurationMs != nil {
			v.DurationMs = uint64(*r.DurationMs)
		}
		out = append(out, v)
	}
	return out, nil
}

var (
	kindNames = map[apiv1alpha.ItemKind]string{
		apiv1alpha.ItemKind_ITEM_KIND_MOVIE: "movie", apiv1alpha.ItemKind_ITEM_KIND_SHOW: "show",
		apiv1alpha.ItemKind_ITEM_KIND_SEASON: "season", apiv1alpha.ItemKind_ITEM_KIND_EPISODE: "episode",
		apiv1alpha.ItemKind_ITEM_KIND_ARTIST: "artist", apiv1alpha.ItemKind_ITEM_KIND_ALBUM: "album",
		apiv1alpha.ItemKind_ITEM_KIND_TRACK: "track",
	}
	kindValues = func() map[string]apiv1alpha.ItemKind {
		m := map[string]apiv1alpha.ItemKind{}
		for k, v := range kindNames {
			m[v] = k
		}
		return m
	}()
	sortNames = map[apiv1alpha.ItemSort]string{
		apiv1alpha.ItemSort_ITEM_SORT_UNSPECIFIED: "title", apiv1alpha.ItemSort_ITEM_SORT_TITLE: "title",
		apiv1alpha.ItemSort_ITEM_SORT_YEAR: "year", apiv1alpha.ItemSort_ITEM_SORT_ADDED: "added",
		apiv1alpha.ItemSort_ITEM_SORT_INDEX: "index",
	}
	streamKinds = map[string]apiv1alpha.StreamKind{
		"video": apiv1alpha.StreamKind_STREAM_KIND_VIDEO, "audio": apiv1alpha.StreamKind_STREAM_KIND_AUDIO,
		"subtitle": apiv1alpha.StreamKind_STREAM_KIND_SUBTITLE, "data": apiv1alpha.StreamKind_STREAM_KIND_DATA,
	}
	hdrFormats = map[string]apiv1alpha.HdrFormat{
		"sdr": apiv1alpha.HdrFormat_HDR_FORMAT_SDR, "hdr10": apiv1alpha.HdrFormat_HDR_FORMAT_HDR10,
		"hdr10plus": apiv1alpha.HdrFormat_HDR_FORMAT_HDR10_PLUS, "hlg": apiv1alpha.HdrFormat_HDR_FORMAT_HLG,
		"dv": apiv1alpha.HdrFormat_HDR_FORMAT_DOLBY_VISION,
	}
)

func libraryKind(kind string) apiv1alpha.LibraryKind {
	switch kind {
	case "movies":
		return apiv1alpha.LibraryKind_LIBRARY_KIND_MOVIES
	case "shows":
		return apiv1alpha.LibraryKind_LIBRARY_KIND_SHOWS
	case "music":
		return apiv1alpha.LibraryKind_LIBRARY_KIND_MUSIC
	}
	return apiv1alpha.LibraryKind_LIBRARY_KIND_UNSPECIFIED
}

func summary(id uuid.UUID, kind, title string, year int32, index, disc *int32, library uuid.UUID, parent *uuid.UUID) *apiv1alpha.ItemSummary {
	s := &apiv1alpha.ItemSummary{
		Id: id.String(), Kind: kindValues[kind], Title: title, Year: year,
		IndexNumber: uint32(derefInt(index)), DiscNumber: uint32(derefInt(disc)), LibraryId: library.String(),
	}
	if parent != nil {
		s.ParentId = parent.String()
	}
	return s
}

func encodeToken(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func decodeToken(token string) (int, error) {
	if token == "" {
		return 0, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(string(b))
	if err != nil || n < 0 {
		return 0, errors.New("bad offset")
	}
	return n, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefInt(n *int32) int32 {
	if n == nil {
		return 0
	}
	return *n
}
