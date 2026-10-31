import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Button } from '@weirhq/m3e'
import { librariesKey } from '../components/AppShell'
import { PosterCard } from '../components/PosterCard'
import cards from '../components/Cards.module.css'
import { libraryRoute } from '../router'

const pageSize = 60

export function LibraryPage() {
  const { libraryId } = libraryRoute.useParams()
  const { api } = useRouteContext({ from: '__root__' })
  const libraries = useQuery({
    queryKey: librariesKey,
    queryFn: async () => (await api.browse.listVisibleLibraries({})).libraries
  })
  const items = useInfiniteQuery({
    queryKey: ['items', libraryId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.browse.listItems({ libraryId, pageSize, pageToken: pageParam }),
    getNextPageParam: (last) => last.nextPageToken || undefined
  })
  const name = libraries.data?.find((l) => l.id === libraryId)?.name ?? ''
  const all = items.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section className={cards.section}>
      <h1 className={cards.heading}>{name}</h1>
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
