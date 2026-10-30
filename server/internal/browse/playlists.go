package browse

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	"github.com/weirhq/weir/server/internal/access"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

const (
	maxPlaylistName  = 128
	maxPlaylistItems = 5000
)

var (
	errNoPlaylist = connect.NewError(connect.CodeNotFound, errors.New("no such playlist"))
	errNotOwner   = connect.NewError(connect.CodePermissionDenied, errors.New("only the playlist's owner can change it"))
	// Playlists hold things that play.
	playlistKinds = map[string]bool{"movie": true, "episode": true, "track": true}
)

// Playlists implements weir.api.v1alpha.Playlists. It shares Browse's
// summaries, so the two render items alike.
type Playlists struct {
	*Service
}

func NewPlaylists(browse *Service) *Playlists { return &Playlists{browse} }

var _ apiv1alpha.PlaylistsHandler = (*Playlists)(nil)

func (p *Playlists) ListPlaylists(ctx context.Context, _ *connect.Request[apiv1alpha.ListPlaylistsRequest]) (*connect.Response[apiv1alpha.ListPlaylistsResponse], error) {
	caller, libs, err := p.visibleLibraries(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := p.store.ListPlaylists(ctx, dbgen.ListPlaylistsParams{UserID: caller.UserID, LibraryIds: libs})
	if err != nil {
		return nil, auth.Internal(ctx, "list playlists", err)
	}
	resp := &apiv1alpha.ListPlaylistsResponse{}
	for _, r := range rows {
		resp.Playlists = append(resp.Playlists, playlistProto(r.ID, r.Name, r.Shared, r.OwnerID, r.OwnerName, int(r.ItemCount)))
	}
	return connect.NewResponse(resp), nil
}

func (p *Playlists) GetPlaylist(ctx context.Context, req *connect.Request[apiv1alpha.GetPlaylistRequest]) (*connect.Response[apiv1alpha.GetPlaylistResponse], error) {
	caller, libs, err := p.visibleLibraries(ctx)
	if err != nil {
		return nil, err
	}
	pl, err := p.readable(ctx, caller, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	rows, err := p.store.PlaylistItems(ctx, dbgen.PlaylistItemsParams{UserID: caller.UserID, PlaylistID: pl.ID, LibraryIds: libs})
	if err != nil {
		return nil, auth.Internal(ctx, "load playlist items", err)
	}
	u := p.urls(caller)
	resp := &apiv1alpha.GetPlaylistResponse{Playlist: playlistProto(pl.ID, pl.Name, pl.Shared, pl.OwnerID, pl.OwnerName, len(rows))}
	for _, r := range rows {
		sum := summary(r.ID, r.Kind, r.Title, r.Year, r.IndexNumber, r.DiscNumber, r.LibraryID, r.ParentID)
		resp.Items = append(resp.Items, u.decorate(sum, r.ID, view{r.PositionMs, r.Watched, r.PlayCount, r.LastPlayed, r.ArtKinds}))
	}
	return connect.NewResponse(resp), nil
}

func (p *Playlists) CreatePlaylist(ctx context.Context, req *connect.Request[apiv1alpha.CreatePlaylistRequest]) (*connect.Response[apiv1alpha.CreatePlaylistResponse], error) {
	caller, err := access.Load(ctx, p.store)
	if err != nil {
		return nil, err
	}
	msg := req.Msg
	name := strings.TrimSpace(msg.Name)
	items, itemsErr := p.checkItems(ctx, caller, msg.ItemIds)
	if err := errors.Join(validatePlaylistName(name), itemsErr); err != nil {
		return nil, auth.InvalidArgument(err)
	}
	id := uuid.Must(uuid.NewV7())
	err = p.store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.CreatePlaylist(ctx, dbgen.CreatePlaylistParams{ID: id, OwnerID: caller.UserID, Name: name, Shared: msg.Shared}); err != nil {
			return err
		}
		return setItems(ctx, q, id, items)
	})
	if err != nil {
		return nil, auth.Internal(ctx, "create playlist", err)
	}
	owner, _ := p.store.GetUser(ctx, caller.UserID)
	return connect.NewResponse(&apiv1alpha.CreatePlaylistResponse{
		Playlist: playlistProto(id, name, msg.Shared, caller.UserID, owner.DisplayName, len(items)),
	}), nil
}

func (p *Playlists) UpdatePlaylist(ctx context.Context, req *connect.Request[apiv1alpha.UpdatePlaylistRequest]) (*connect.Response[apiv1alpha.UpdatePlaylistResponse], error) {
	caller, err := access.Load(ctx, p.store)
	if err != nil {
		return nil, err
	}
	msg := req.Msg
	pl, err := p.owned(ctx, caller, msg.Id)
	if err != nil {
		return nil, err
	}
	mask := msg.GetUpdateMask().GetPaths()
	if len(mask) == 0 {
		return nil, auth.InvalidArgument(errors.New("update_mask names no fields"))
	}
	name, shared := pl.Name, pl.Shared
	var items []uuid.UUID
	setList := false
	for _, f := range mask {
		switch f {
		case "name":
			name = strings.TrimSpace(msg.Name)
			if err := validatePlaylistName(name); err != nil {
				return nil, auth.InvalidArgument(err)
			}
		case "shared":
			shared = msg.Shared
		case "item_ids":
			setList = true
			if items, err = p.checkItems(ctx, caller, msg.ItemIds); err != nil {
				return nil, auth.InvalidArgument(err)
			}
		default:
			return nil, auth.InvalidArgument(fmt.Errorf("update_mask: unknown field %q", f))
		}
	}
	err = p.store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.UpdatePlaylist(ctx, dbgen.UpdatePlaylistParams{ID: pl.ID, Name: name, Shared: shared}); err != nil {
			return err
		}
		if setList {
			return setItems(ctx, q, pl.ID, items)
		}
		return nil
	})
	if err != nil {
		return nil, auth.Internal(ctx, "update playlist", err)
	}
	got, err := p.GetPlaylist(ctx, connect.NewRequest(&apiv1alpha.GetPlaylistRequest{Id: pl.ID.String()}))
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&apiv1alpha.UpdatePlaylistResponse{Playlist: got.Msg.Playlist}), nil
}

func (p *Playlists) DeletePlaylist(ctx context.Context, req *connect.Request[apiv1alpha.DeletePlaylistRequest]) (*connect.Response[apiv1alpha.DeletePlaylistResponse], error) {
	caller, err := access.Load(ctx, p.store)
	if err != nil {
		return nil, err
	}
	pl, err := p.owned(ctx, caller, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if err := p.store.DeletePlaylist(ctx, pl.ID); err != nil {
		return nil, auth.Internal(ctx, "delete playlist", err)
	}
	return connect.NewResponse(&apiv1alpha.DeletePlaylistResponse{}), nil
}

// readable loads a playlist the caller owns or that is shared.
func (p *Playlists) readable(ctx context.Context, caller *access.Caller, id string) (dbgen.GetPlaylistRow, error) {
	plID, err := uuid.Parse(id)
	if err != nil {
		return dbgen.GetPlaylistRow{}, errNoPlaylist
	}
	pl, err := p.store.GetPlaylist(ctx, plID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && pl.OwnerID != caller.UserID && !pl.Shared {
		return dbgen.GetPlaylistRow{}, errNoPlaylist
	}
	if err != nil {
		return dbgen.GetPlaylistRow{}, auth.Internal(ctx, "load playlist", err)
	}
	return pl, nil
}

// owned loads a playlist the caller may change.
func (p *Playlists) owned(ctx context.Context, caller *access.Caller, id string) (dbgen.GetPlaylistRow, error) {
	pl, err := p.readable(ctx, caller, id)
	if err != nil {
		return pl, err
	}
	if pl.OwnerID != caller.UserID {
		return pl, errNotOwner
	}
	return pl, nil
}

// checkItems parses item ids and checks each is something playable the
// caller may see.
func (p *Playlists) checkItems(ctx context.Context, caller *access.Caller, ids []string) ([]uuid.UUID, error) {
	if len(ids) > maxPlaylistItems {
		return nil, fmt.Errorf("a playlist holds at most %d items", maxPlaylistItems)
	}
	var parsed []uuid.UUID
	for _, s := range ids {
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, fmt.Errorf("%q is not an item id", s)
		}
		parsed = append(parsed, id)
	}
	rows, err := p.store.ItemsByID(ctx, parsed)
	if err != nil {
		return nil, err
	}
	found := map[uuid.UUID]dbgen.ItemsByIDRow{}
	for _, r := range rows {
		found[r.ID] = r
	}
	for _, id := range parsed {
		it, ok := found[id]
		if !ok || !caller.In(it.LibraryID).View {
			return nil, fmt.Errorf("no such item %s", id)
		}
		if !playlistKinds[it.Kind] {
			return nil, fmt.Errorf("a %s can't go in a playlist; add its films, episodes or tracks", it.Kind)
		}
	}
	return parsed, nil
}

func setItems(ctx context.Context, q *dbgen.Queries, playlist uuid.UUID, items []uuid.UUID) error {
	if err := q.ClearPlaylistItems(ctx, playlist); err != nil {
		return err
	}
	for i, item := range items {
		if err := q.AddPlaylistItem(ctx, dbgen.AddPlaylistItemParams{PlaylistID: playlist, Position: int32(i), ItemID: item}); err != nil {
			return err
		}
	}
	return nil
}

func validatePlaylistName(name string) error {
	if n := utf8.RuneCountInString(name); n == 0 || n > maxPlaylistName {
		return fmt.Errorf("a playlist name must be 1 to %d characters", maxPlaylistName)
	}
	return nil
}

func playlistProto(id uuid.UUID, name string, shared bool, owner uuid.UUID, ownerName string, count int) *apiv1alpha.Playlist {
	return &apiv1alpha.Playlist{
		Id: id.String(), Name: name, Shared: shared, OwnerId: owner.String(), OwnerName: ownerName, ItemCount: uint32(count),
	}
}
