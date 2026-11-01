import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { PosterCard } from '../components/PosterCard'
import { Row } from '../components/Row'
import { librariesKey } from '../components/AppShell'
import {
  ItemKind,
  ItemSort,
  type ItemSummary
} from '../gen/weir/api/v1alpha/browse_pb'
import { LibraryKind, type Library } from '../gen/weir/api/v1alpha/library_pb'
import { Role } from '../gen/weir/api/v1alpha/user_pb'
import type { LibrarySearch } from '../router'
import cards from '../components/Cards.module.css'

// Cards in a row; the title's link has the rest.
const rowSize = 20

export function HomePage() {
  const { api, session } = useRouteContext({ from: '__root__' })
  const continueWatching = useQuery({
    queryKey: ['continueWatching'],
    queryFn: async () => (await api.browse.listContinueWatching({})).items
  })
  const libraries = useQuery({
    queryKey: librariesKey,
    queryFn: async () => (await api.browse.listVisibleLibraries({})).libraries
  })

  if (libraries.data?.length === 0) {
    return (
      <section className={cards.section}>
        <h1 className={cards.heading}>No libraries yet</h1>
        <p className={cards.empty}>
          {session.user?.role === Role.ADMIN
            ? 'Add a library of films, shows or music to get started.'
            : 'Ask an admin to share a library with you.'}
        </p>
      </section>
    )
  }
  return (
    <>
      <Row title="Continue watching" wide>
        {(continueWatching.data ?? []).map((item) => (
          <PosterCard key={item.id} item={item} wide />
        ))}
      </Row>
      {(libraries.data ?? []).map((library) => (
        <LibraryRows key={library.id} library={library} />
      ))}
    </>
  )
}

/**
 * A library's rows, as Plex has: what's new to it, what's newly released,
 * what's unwatched, and its two biggest genres; for music, its albums.
 * Each title leads to the library listed the same way. A row that would
 * only repeat one above it, as in a small library, is left out.
 */
function LibraryRows({ library }: { library: Library }) {
  const { api } = useRouteContext({ from: '__root__' })
  const libraryId = library.id
  const watchable =
    library.kind === LibraryKind.MOVIES || library.kind === LibraryKind.SHOWS
  // A music library's top level is its artists; its rows are of albums.
  const music = library.kind === LibraryKind.MUSIC
  const kinds = music ? [ItemKind.ALBUM] : []
  const recent = useQuery({
    queryKey: ['recentlyAdded', libraryId],
    queryFn: async () =>
      (await api.browse.listRecentlyAdded({ libraryId })).items
  })
  const released = useQuery({
    queryKey: ['row', libraryId, 'released'],
    queryFn: async () =>
      (
        await api.browse.listItems({
          libraryId,
          kinds,
          sort: ItemSort.RELEASED,
          pageSize: rowSize
        })
      ).items
  })
  const unwatched = useQuery({
    queryKey: ['row', libraryId, 'unwatched'],
    enabled: watchable,
    queryFn: async () =>
      (
        await api.browse.listItems({
          libraryId,
          unwatched: true,
          sort: ItemSort.ADDED,
          pageSize: rowSize
        })
      ).items
  })
  const facets = useQuery({
    queryKey: ['facets', libraryId, music],
    queryFn: () => api.browse.listLibraryFacets({ libraryId, kinds })
  })
  const genres = (facets.data?.genres ?? []).slice(0, 2).map((g) => g.genre)
  const byGenre = useQueries({
    queries: genres.map((genre) => ({
      queryKey: ['row', libraryId, 'genre', genre],
      queryFn: async () =>
        (
          await api.browse.listItems({
            libraryId,
            kinds,
            genre,
            sort: ItemSort.RELEASED,
            pageSize: rowSize
          })
        ).items
    }))
  })

  const albums = music ? { albums: true } : {}
  const rows: { title: string; items: ItemSummary[]; search: LibrarySearch }[] =
    [
      {
        title: 'Recently added',
        items: recent.data ?? [],
        search: { sort: 'added', ...albums }
      },
      {
        title: 'Recently released',
        items: released.data ?? [],
        search: { sort: 'released', ...albums }
      },
      ...(watchable
        ? [
            {
              title: 'Unwatched',
              items: unwatched.data ?? [],
              search: { sort: 'added', unwatched: true } as LibrarySearch
            }
          ]
        : []),
      ...genres.map((genre, i) => ({
        title: genre,
        items: byGenre[i]?.data ?? [],
        search: { sort: 'released', genre, ...albums } as LibrarySearch
      }))
    ]
  // What each row holds, to leave out one that repeats another.
  const seen = new Set<string>()
  const shown = rows.filter(({ items }) => {
    if (items.length === 0) return false
    const holds = items
      .map((i) => i.id)
      .sort()
      .join(' ')
    if (seen.has(holds)) return false
    seen.add(holds)
    return true
  })
  return (
    <>
      {shown.map(({ title, items, search }) => (
        <Row
          key={title}
          title={`${title} in ${library.name}`}
          link={
            <Link
              to="/library/$libraryId"
              params={{ libraryId }}
              search={search}
            />
          }
        >
          {items.map((item) => (
            <PosterCard key={item.id} item={item} />
          ))}
        </Row>
      ))}
    </>
  )
}
