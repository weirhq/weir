import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { Button, FilterChip, Select } from '@weirhq/m3e'
import { librariesKey } from '../components/AppShell'
import { PosterCard } from '../components/PosterCard'
import cards from '../components/Cards.module.css'
import { ItemSort } from '../gen/weir/api/v1alpha/browse_pb'
import { LibraryKind } from '../gen/weir/api/v1alpha/library_pb'
import { libraryRoute, type LibrarySearch, type LibrarySort } from '../router'
import styles from './LibraryPage.module.css'

const pageSize = 60

const sorts: { value: LibrarySort; label: string; sort: ItemSort }[] = [
  { value: 'title', label: 'Title', sort: ItemSort.TITLE },
  { value: 'year', label: 'Year', sort: ItemSort.YEAR },
  { value: 'added', label: 'Recently added', sort: ItemSort.ADDED },
  { value: 'released', label: 'Recently released', sort: ItemSort.RELEASED }
]

// Radix's select has no empty value, so "any" is a word of its own.
const any = 'any'

export function LibraryPage() {
  const { libraryId } = libraryRoute.useParams()
  const search = libraryRoute.useSearch()
  const { sort = 'title', unwatched = false, genre, decade } = search
  const navigate = useNavigate({ from: libraryRoute.fullPath })
  const { api } = useRouteContext({ from: '__root__' })
  const libraries = useQuery({
    queryKey: librariesKey,
    queryFn: async () => (await api.browse.listVisibleLibraries({})).libraries
  })
  const facets = useQuery({
    queryKey: ['facets', libraryId],
    queryFn: () => api.browse.listLibraryFacets({ libraryId })
  })
  const items = useInfiniteQuery({
    queryKey: ['items', libraryId, sort, unwatched, genre, decade],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.browse.listItems({
        libraryId,
        sort: sorts.find((s) => s.value === sort)!.sort,
        unwatched,
        genre,
        decade,
        pageSize,
        pageToken: pageParam
      }),
    getNextPageParam: (last) => last.nextPageToken || undefined
  })
  const library = libraries.data?.find((l) => l.id === libraryId)
  const watchable =
    library?.kind === LibraryKind.MOVIES || library?.kind === LibraryKind.SHOWS
  const all = items.data?.pages.flatMap((p) => p.items) ?? []
  const filtered = unwatched || genre !== undefined || decade !== undefined
  // Changes the address, which is what the page lists from.
  const show = (change: LibrarySearch) =>
    void navigate({ search: { ...search, ...change }, replace: true })

  return (
    <section className={cards.section}>
      <div className={styles.head}>
        <h1 className={cards.heading}>{library?.name ?? ''}</h1>
        <div className={styles.controls}>
          {watchable && (
            <FilterChip
              selected={unwatched}
              onClick={() => show({ unwatched: unwatched ? undefined : true })}
            >
              Unwatched
            </FilterChip>
          )}
          {(facets.data?.genres.length ?? 0) > 0 && (
            <Select
              className={styles.control}
              label="Genre"
              value={genre ?? any}
              onValueChange={(v) => show({ genre: v === any ? undefined : v })}
              options={[
                { value: any, label: 'Any' },
                ...facets.data!.genres.map((g) => ({
                  value: g.genre,
                  label: g.genre
                }))
              ]}
            />
          )}
          {(facets.data?.decades.length ?? 0) > 0 && (
            <Select
              className={styles.control}
              label="Decade"
              value={decade !== undefined ? String(decade) : any}
              onValueChange={(v) =>
                show({ decade: v === any ? undefined : Number(v) })
              }
              options={[
                { value: any, label: 'Any' },
                ...facets.data!.decades.map((d) => ({
                  value: String(d.decade),
                  label: `${d.decade}s`
                }))
              ]}
            />
          )}
          <Select
            className={styles.control}
            label="Sort by"
            value={sort}
            onValueChange={(v) => show({ sort: v as LibrarySort })}
            options={sorts.map(({ value, label }) => ({ value, label }))}
          />
        </div>
      </div>
      {items.isSuccess && all.length === 0 && (
        <p className={cards.empty}>
          {filtered
            ? 'Nothing here matches these filters.'
            : 'Nothing here yet. A scan may still be running.'}
        </p>
      )}
      <div className={cards.grid}>
        {all.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
      {items.hasNextPage && (
        <p>
          <Button
            variant="tonal"
            disabled={items.isFetchingNextPage}
            onClick={() => void items.fetchNextPage()}
          >
            Show more
          </Button>
        </p>
      )}
    </section>
  )
}
