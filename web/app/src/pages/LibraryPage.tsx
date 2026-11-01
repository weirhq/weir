import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { Button, Select } from '@weirhq/m3e'
import { librariesKey } from '../components/AppShell'
import { PosterCard } from '../components/PosterCard'
import cards from '../components/Cards.module.css'
import { ItemSort } from '../gen/weir/api/v1alpha/browse_pb'
import { libraryRoute, type LibrarySort } from '../router'
import styles from './LibraryPage.module.css'

const pageSize = 60

const sorts: { value: LibrarySort; label: string; sort: ItemSort }[] = [
  { value: 'title', label: 'Title', sort: ItemSort.TITLE },
  { value: 'year', label: 'Year', sort: ItemSort.YEAR },
  { value: 'added', label: 'Recently added', sort: ItemSort.ADDED }
]

export function LibraryPage() {
  const { libraryId } = libraryRoute.useParams()
  const { sort = 'title' } = libraryRoute.useSearch()
  const navigate = useNavigate({ from: libraryRoute.fullPath })
  const { api } = useRouteContext({ from: '__root__' })
  const libraries = useQuery({
    queryKey: librariesKey,
    queryFn: async () => (await api.browse.listVisibleLibraries({})).libraries
  })
  const items = useInfiniteQuery({
    queryKey: ['items', libraryId, sort],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.browse.listItems({
        libraryId,
        sort: sorts.find((s) => s.value === sort)!.sort,
        pageSize,
        pageToken: pageParam
      }),
    getNextPageParam: (last) => last.nextPageToken || undefined
  })
  const name = libraries.data?.find((l) => l.id === libraryId)?.name ?? ''
  const all = items.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section className={cards.section}>
      <div className={styles.head}>
        <h1 className={cards.heading}>{name}</h1>
        <Select
          className={styles.sort}
          label="Sort by"
          value={sort}
          onValueChange={(v) =>
            void navigate({
              search: { sort: v as LibrarySort },
              replace: true
            })
          }
          options={sorts.map(({ value, label }) => ({ value, label }))}
        />
      </div>
      {items.isSuccess && all.length === 0 && (
        <p className={cards.empty}>
          Nothing here yet. A scan may still be running.
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
