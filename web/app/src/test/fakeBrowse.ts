import { create } from '@bufbuild/protobuf'
import { durationFromMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter } from '@connectrpc/connect'
import {
  Browse,
  ItemKind,
  ItemSchema,
  ItemSummarySchema,
  StreamKind,
  UserDataSchema,
  type Item,
  type ItemSummary
} from '../gen/weir/api/v1alpha/browse_pb'
import { LibraryKind, LibrarySchema } from '../gen/weir/api/v1alpha/library_pb'
import {
  HdrFormat,
  Playback,
  PlaybackPlanSchema,
  type HeartbeatRequest,
  type PlaybackPlan,
  type StartRequest,
  type StopRequest
} from '../gen/weir/api/v1alpha/playback_pb'
import {
  PlaylistSchema,
  Playlists,
  type Playlist
} from '../gen/weir/api/v1alpha/playlists_pb'

type FakePlaylist = Omit<Playlist, 'itemCount' | '$typeName'> & {
  itemIds: string[]
}

/**
 * A small library to browse: two films, a show with one season, and an
 * album; and two playlists, one of them someone else's.
 */
export class FakeBrowse {
  libraries = [
    create(LibrarySchema, {
      id: 'films',
      name: 'Films',
      kind: LibraryKind.MOVIES
    }),
    create(LibrarySchema, { id: 'tv', name: 'TV', kind: LibraryKind.SHOWS }),
    create(LibrarySchema, {
      id: 'music',
      name: 'Music',
      kind: LibraryKind.MUSIC
    })
  ]
  summaries: ItemSummary[] = [
    summary('arrival', ItemKind.MOVIE, 'Arrival', {
      year: 2016,
      libraryId: 'films',
      posterUrl: '/media/artwork/arrival/poster?sig=x',
      position: 40 * 60_000
    }),
    summary('zodiac', ItemKind.MOVIE, 'Zodiac', {
      year: 2007,
      libraryId: 'films'
    }),
    summary('severance', ItemKind.SHOW, 'Severance', {
      year: 2022,
      libraryId: 'tv'
    }),
    summary('s1', ItemKind.SEASON, 'Season 1', {
      libraryId: 'tv',
      parentId: 'severance',
      indexNumber: 1
    }),
    summary('s1e1', ItemKind.EPISODE, 'Good News About Hell', {
      libraryId: 'tv',
      parentId: 's1',
      indexNumber: 1,
      watched: true
    }),
    summary('s1e2', ItemKind.EPISODE, 'Half Loop', {
      libraryId: 'tv',
      parentId: 's1',
      indexNumber: 2
    }),
    summary('boc', ItemKind.ARTIST, 'Boards of Canada', {
      libraryId: 'music'
    }),
    summary('mhtrtc', ItemKind.ALBUM, 'Music Has the Right to Children', {
      year: 1998,
      libraryId: 'music',
      parentId: 'boc'
    }),
    ...[
      'Wildlife Analysis',
      'An Eagle in Your Mind',
      'The Color of the Fire'
    ].map((title, i) =>
      summary(`t${i + 1}`, ItemKind.TRACK, title, {
        libraryId: 'music',
        parentId: 'mhtrtc',
        indexNumber: i + 1
      })
    )
  ]
  playlists: FakePlaylist[] = [
    {
      id: 'rainy',
      name: 'Rainy day',
      ownerId: 'u1',
      ownerName: 'Luna',
      shared: false,
      itemIds: ['t2', 'arrival', 't3']
    },
    {
      id: 'mix',
      name: 'Road trip',
      ownerId: 'u2',
      ownerName: 'Ana',
      shared: true,
      itemIds: ['t1']
    }
  ]
  watchedCalls: { itemId: string; watched: boolean }[] = []
  // What Playback.Start answers, or the error it throws.
  plan: PlaybackPlan | ConnectError = create(PlaybackPlanSchema, {})
  starts: StartRequest[] = []
  heartbeats: HeartbeatRequest[] = []
  stops: StopRequest[] = []

  get(id: string): ItemSummary {
    const s = this.summaries.find((x) => x.id === id)
    if (!s) throw new ConnectError('no such item', Code.NotFound)
    return s
  }

  detail(id: string): Item {
    const s = this.get(id)
    const ancestors: ItemSummary[] = []
    for (let p = s.parentId; p; p = this.get(p).parentId)
      ancestors.unshift(this.get(p))
    return create(ItemSchema, {
      summary: s,
      overview:
        id === 'arrival'
          ? 'A linguist works with the military to talk to aliens.'
          : '',
      tagline: id === 'arrival' ? 'Why are they here?' : '',
      runtimeMinutes: id === 'arrival' ? 116 : 0,
      rating: id === 'arrival' ? 7.9 : 0,
      contentRating: id === 'arrival' ? 'PG-13' : '',
      genres: id === 'arrival' ? ['Drama', 'Science Fiction'] : [],
      cast:
        id === 'arrival' ? [{ name: 'Amy Adams', role: 'Louise Banks' }] : [],
      ancestors,
      versions:
        s.kind === ItemKind.TRACK
          ? [
              {
                id: `${id}-v1`,
                container: 'flac',
                streams: [
                  {
                    index: 0,
                    kind: StreamKind.AUDIO,
                    codec: 'flac',
                    channels: 2
                  }
                ]
              }
            ]
          : s.kind === ItemKind.MOVIE || s.kind === ItemKind.EPISODE
            ? [
                {
                  id: `${id}-v1`,
                  edition: id === 'arrival' ? '4K' : '',
                  container: 'matroska,webm',
                  sizeBytes: 54_200_000_000n,
                  streams: [
                    {
                      index: 0,
                      kind: StreamKind.VIDEO,
                      codec: 'hevc',
                      height: 2160,
                      hdrFormat: HdrFormat.DOLBY_VISION
                    },
                    {
                      index: 1,
                      kind: StreamKind.AUDIO,
                      codec: 'truehd',
                      language: 'en',
                      channels: 8
                    },
                    {
                      index: 2,
                      kind: StreamKind.SUBTITLE,
                      codec: 'subrip',
                      language: 'en'
                    }
                  ]
                }
              ]
            : []
    })
  }

  playlist(id: string): FakePlaylist {
    const p = this.playlists.find((x) => x.id === id)
    if (!p) throw new ConnectError('no such playlist', Code.NotFound)
    return p
  }

  playlistProto(p: FakePlaylist): Playlist {
    const { itemIds, ...rest } = p
    return create(PlaylistSchema, { ...rest, itemCount: itemIds.length })
  }

  // Everyone in these tests is u1, the fake's admin.
  owned(id: string): FakePlaylist {
    const p = this.playlist(id)
    if (p.ownerId !== 'u1')
      throw new ConnectError('not your playlist', Code.PermissionDenied)
    return p
  }

  register(router: ConnectRouter) {
    router.service(Browse, {
      listVisibleLibraries: () => ({ libraries: this.libraries }),
      listItems: (req) => {
        const all = this.summaries.filter((s) =>
          req.parentId
            ? s.parentId === req.parentId
            : s.libraryId === req.libraryId && !s.parentId
        )
        const offset = Number(req.pageToken || '0')
        const size = req.pageSize || 100
        const page = all.slice(offset, offset + size)
        const next = offset + size < all.length ? String(offset + size) : ''
        return { items: page, total: all.length, nextPageToken: next }
      },
      getItem: (req) => ({ item: this.detail(req.id) }),
      search: (req) => ({
        items: this.summaries.filter((s) =>
          s.title.toLowerCase().includes(req.query.toLowerCase())
        )
      }),
      listContinueWatching: () => ({
        items: this.summaries.filter(
          (s) => s.userData?.position && !s.userData.watched
        )
      }),
      listRecentlyAdded: () => ({
        items: this.summaries.filter((s) => !s.parentId)
      })
    })
    router.service(Playlists, {
      listPlaylists: () => ({
        playlists: this.playlists
          .filter((p) => p.ownerId === 'u1' || p.shared)
          .map((p) => this.playlistProto(p))
      }),
      getPlaylist: (req) => {
        const p = this.playlist(req.id)
        return {
          playlist: this.playlistProto(p),
          items: p.itemIds.map((id) => this.get(id))
        }
      },
      createPlaylist: (req) => {
        const p: FakePlaylist = {
          id: `p${this.playlists.length + 1}`,
          name: req.name,
          ownerId: 'u1',
          ownerName: 'Luna',
          shared: req.shared,
          itemIds: req.itemIds
        }
        this.playlists.push(p)
        return { playlist: this.playlistProto(p) }
      },
      updatePlaylist: (req) => {
        const p = this.owned(req.id)
        for (const f of req.updateMask?.paths ?? []) {
          if (f === 'name') p.name = req.name
          if (f === 'shared') p.shared = req.shared
          if (f === 'item_ids') p.itemIds = req.itemIds
        }
        return { playlist: this.playlistProto(p) }
      },
      deletePlaylist: (req) => {
        this.owned(req.id)
        this.playlists = this.playlists.filter((p) => p.id !== req.id)
        return {}
      }
    })
    router.service(Playback, {
      start: (req) => {
        this.starts.push(req)
        if (this.plan instanceof ConnectError) throw this.plan
        return { plan: this.plan }
      },
      heartbeat: (req) => {
        this.heartbeats.push(req)
        return {}
      },
      stop: (req) => {
        this.stops.push(req)
        return {}
      },
      setWatched: (req) => {
        this.watchedCalls.push({ itemId: req.itemId, watched: req.watched })
        return {}
      }
    })
  }
}

function summary(
  id: string,
  kind: ItemKind,
  title: string,
  o: {
    year?: number
    libraryId: string
    parentId?: string
    indexNumber?: number
    posterUrl?: string
    position?: number
    watched?: boolean
  }
): ItemSummary {
  return create(ItemSummarySchema, {
    id,
    kind,
    title,
    year: o.year ?? 0,
    libraryId: o.libraryId,
    parentId: o.parentId ?? '',
    indexNumber: o.indexNumber ?? 0,
    posterUrl: o.posterUrl ?? '',
    userData:
      o.position || o.watched
        ? create(UserDataSchema, {
            position: o.position ? durationFromMs(o.position) : undefined,
            watched: o.watched ?? false
          })
        : undefined
  })
}
