import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { Button, FilterChip, Menu, MenuItem } from '@weirhq/m3e'
import { librariesKey } from '../components/AppShell'
import { PosterCard } from '../components/PosterCard'
import cards from '../components/Cards.module.css'
import { ItemKind, ItemSort } from '../gen/weir/api/v1alpha/browse_pb'
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

// The menus' value for no filter.
const any = 'any'

/**
 * A filter chip that opens a menu of choices, showing the chosen one, as
 * M3's filter chips with menus do. Chosen, it's filled with a check.
 */
function MenuChip({
  label,
  chosen,
  value,
  options,
  onChoose
}: {
  label: string
  chosen: boolean
  value: string
  options: { value: string; label: string }[]
  onChoose: (value: string) => void
}) {
  return (
    <Menu
      trigger={
        // It opens a menu rather than toggling, so it isn't pressed.
        <FilterChip
          selected={chosen}
          trailingIcon="arrow_drop_down"
          aria-pressed={undefined}
        >
          {label}
        </FilterChip>
      }
    >
      {options.map((o) => (
        <MenuItem
          key={o.value}
          trailingIcon={o.value === value ? 'check' : undefined}
          onSelect={() => onChoose(o.value)}
        >
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  )
}

export function LibraryPage() {
  const { libraryId } = libraryRoute.useParams()
  const search = libraryRoute.useSearch()
  const {
    sort = 'title',
    unwatched = false,
    genre,
    decade,
    albums = false
  } = search
  // A music library lists its artists, or with albums its albums.
  const kinds = albums ? [ItemKind.ALBUM] : []
  const navigate = useNavigate({ from: libraryRoute.fullPath })
  const { api } = useRouteContext({ from: '__root__' })
  const libraries = useQuery({
    queryKey: librariesKey,
    queryFn: async () => (await api.browse.listVisibleLibraries({})).libraries
  })
  const facets = useQuery({
    queryKey: ['facets', libraryId, albums],
    queryFn: () => api.browse.listLibraryFacets({ libraryId, kinds })
  })
  const items = useInfiniteQuery({
    queryKey: ['items', libraryId, sort, unwatched, genre, decade, albums],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.browse.listItems({
        libraryId,
        kinds,
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
  const music = library?.kind === LibraryKind.MUSIC
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
          {music && (
            <MenuChip
              label={albums ? 'Albums' : 'Artists'}
              chosen={false}
              value={albums ? 'albums' : 'artists'}
              options={[
                { value: 'artists', label: 'Artists' },
                { value: 'albums', label: 'Albums' }
              ]}
              // Genres and decades differ between the two; start afresh.
              onChoose={(v) =>
                show({
                  albums: v === 'albums' ? true : undefined,
                  genre: undefined,
                  decade: undefined
                })
              }
            />
          )}
          {watchable && (
            <FilterChip
              selected={unwatched}
              onClick={() => show({ unwatched: unwatched ? undefined : true })}
            >
              Unwatched
            </FilterChip>
          )}
          {(facets.data?.genres.length ?? 0) > 0 && (
            <MenuChip
              label={genre ?? 'Genre'}
              chosen={genre !== undefined}
              value={genre ?? any}
              options={[
                { value: any, label: 'Any genre' },
                ...facets.data!.genres.map((g) => ({
                  value: g.genre,
                  label: g.genre
                }))
              ]}
              onChoose={(v) => show({ genre: v === any ? undefined : v })}
            />
          )}
          {(facets.data?.decades.length ?? 0) > 0 && (
            <MenuChip
              label={decade !== undefined ? `${decade}s` : 'Decade'}
              chosen={decade !== undefined}
              value={decade !== undefined ? String(decade) : any}
              options={[
                { value: any, label: 'Any decade' },
                ...facets.data!.decades.map((d) => ({
                  value: String(d.decade),
                  label: `${d.decade}s`
                }))
              ]}
              onChoose={(v) =>
                show({ decade: v === any ? undefined : Number(v) })
              }
            />
          )}
          <MenuChip
            label={sorts.find((s) => s.value === sort)!.label}
            chosen={false}
            value={sort}
            options={sorts.map(({ value, label }) => ({ value, label }))}
            onChoose={(v) => show({ sort: v as LibrarySort })}
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
