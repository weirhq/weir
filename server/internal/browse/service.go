// Package browse implements weir.api.v1alpha.Browse: listing, viewing and
// searching what the caller may see.
package browse

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/access"
	"github.com/weirhq/weir/server/internal/artwork"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/media"
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
	store  *store.Store
	signer *media.Signer
}

func NewService(st *store.Store, signer *media.Signer) *Service {
	return &Service{store: st, signer: signer}
}

// artworkTTL bounds how long a page's image links work.
const artworkTTL = 24 * time.Hour

// view is the caller's state for an item and which pictures it has.
type view struct {
	positionMs *int64
	watched    *bool
	playCount  *int32
	lastPlayed *time.Time
	artKinds   []string
}

// urls signs artwork links for one caller; one signature covers them all.
type urls struct{ query string }

func (s *Service) urls(caller *access.Caller) urls {
	return urls{s.signer.SignScope(artwork.Prefix, caller.UserID, artworkTTL)}
}

func (u urls) art(item uuid.UUID, kind string, kinds []string) string {
	if !slices.Contains(kinds, kind) {
		return ""
	}
	return artwork.Prefix + item.String() + "/" + kind + "?" + u.query
}

func (u urls) decorate(sum *apiv1alpha.ItemSummary, id uuid.UUID, v view) *apiv1alpha.ItemSummary {
	sum.PosterUrl = u.art(id, "poster", v.artKinds)
	sum.ThumbUrl = u.art(id, "thumb", v.artKinds)
	if v.watched != nil || v.positionMs != nil {
		ud := &apiv1alpha.UserData{}
		if v.positionMs != nil {
			ud.Position = durationpb.New(time.Duration(*v.positionMs) * time.Millisecond)
		}
		if v.watched != nil {
			ud.Watched = *v.watched
		}
		if v.playCount != nil {
			ud.PlayCount = uint32(*v.playCount)
		}
		if v.lastPlayed != nil {
			ud.LastPlayed = timestamppb.New(*v.lastPlayed)
		}
		sum.UserData = ud
	}
	return sum
}

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
	params := dbgen.ListItemsParams{Kinds: []string{}, UserID: caller.UserID}
	u := s.urls(caller)
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
		sum := summary(r.ID, r.Kind, r.Title, r.Year, r.IndexNumber, r.DiscNumber, r.LibraryID, r.ParentID)
		resp.Items = append(resp.Items, u.decorate(sum, r.ID, view{r.PositionMs, r.Watched, r.PlayCount, r.LastPlayed, r.ArtKinds}))
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
	uv, err := s.store.ItemUserView(ctx, dbgen.ItemUserViewParams{ItemID: it.ID, UserID: caller.UserID})
	if err != nil {
		return nil, auth.Internal(ctx, "load user state", err)
	}
	u := s.urls(caller)
	u.decorate(item.Summary, it.ID, view{uv.PositionMs, uv.Watched, uv.PlayCount, uv.LastPlayed, uv.ArtKinds})
	item.BackdropUrl = u.art(it.ID, "backdrop", uv.ArtKinds)
	item.LogoUrl = u.art(it.ID, "logo", uv.ArtKinds)

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
		Query: query, LibraryIds: caller.Visible(ids), MaxResults: int32(min(limit, maxResults)), UserID: caller.UserID,
	})
	if err != nil {
		return nil, auth.Internal(ctx, "search", err)
	}
	u := s.urls(caller)
	resp := &apiv1alpha.SearchResponse{}
	for _, r := range rows {
		sum := summary(r.ID, r.Kind, r.Title, r.Year, r.IndexNumber, r.DiscNumber, r.LibraryID, r.ParentID)
		resp.Items = append(resp.Items, u.decorate(sum, r.ID, view{r.PositionMs, r.Watched, r.PlayCount, r.LastPlayed, r.ArtKinds}))
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) ListContinueWatching(ctx context.Context, req *connect.Request[apiv1alpha.ListContinueWatchingRequest]) (*connect.Response[apiv1alpha.ListContinueWatchingResponse], error) {
	caller, libs, err := s.visibleLibraries(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.store.ContinueWatching(ctx, dbgen.ContinueWatchingParams{
		UserID: caller.UserID, LibraryIds: libs, MaxResults: resultLimit(req.Msg.Limit),
	})
	if err != nil {
		return nil, auth.Internal(ctx, "continue watching", err)
	}
	u := s.urls(caller)
	resp := &apiv1alpha.ListContinueWatchingResponse{}
	for _, r := range rows {
		sum := summary(r.ID, r.Kind, r.Title, r.Year, r.IndexNumber, r.DiscNumber, r.LibraryID, r.ParentID)
		watched, count := r.Watched, r.PlayCount
		resp.Items = append(resp.Items, u.decorate(sum, r.ID, view{&r.PositionMs, &watched, &count, r.LastPlayed, r.ArtKinds}))
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) ListRecentlyAdded(ctx context.Context, req *connect.Request[apiv1alpha.ListRecentlyAddedRequest]) (*connect.Response[apiv1alpha.ListRecentlyAddedResponse], error) {
	caller, libs, err := s.visibleLibraries(ctx)
	if err != nil {
		return nil, err
	}
	kinds := []string{"movie", "show", "album"}
	if len(req.Msg.Kinds) > 0 {
		kinds = nil
		for _, k := range req.Msg.Kinds {
			if name, ok := kindNames[k]; ok {
				kinds = append(kinds, name)
			}
		}
	}
	rows, err := s.store.RecentlyAdded(ctx, dbgen.RecentlyAddedParams{
		UserID: caller.UserID, Kinds: kinds, LibraryIds: libs, MaxResults: resultLimit(req.Msg.Limit),
	})
	if err != nil {
		return nil, auth.Internal(ctx, "recently added", err)
	}
	u := s.urls(caller)
	resp := &apiv1alpha.ListRecentlyAddedResponse{}
	for _, r := range rows {
		sum := summary(r.ID, r.Kind, r.Title, r.Year, r.IndexNumber, r.DiscNumber, r.LibraryID, r.ParentID)
		resp.Items = append(resp.Items, u.decorate(sum, r.ID, view{r.PositionMs, r.Watched, r.PlayCount, r.LastPlayed, r.ArtKinds}))
	}
	return connect.NewResponse(resp), nil
}

func (s *Service) visibleLibraries(ctx context.Context) (*access.Caller, []uuid.UUID, error) {
	caller, err := access.Load(ctx, s.store)
	if err != nil {
		return nil, nil, err
	}
	libs, err := s.store.ListLibraries(ctx)
	if err != nil {
		return nil, nil, auth.Internal(ctx, "list libraries", err)
	}
	var ids []uuid.UUID
	for _, l := range libs {
		ids = append(ids, l.ID)
	}
	return caller, caller.Visible(ids), nil
}

func resultLimit(limit uint32) int32 {
	if limit == 0 {
		limit = defaultResults
	}
	return int32(min(limit, maxResults))
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
