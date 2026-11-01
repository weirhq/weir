import { useQueries, useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { PosterCard } from '../components/PosterCard'
import { Row } from '../components/Row'
import { librariesKey } from '../components/AppShell'
import { Role } from '../gen/weir/api/v1alpha/user_pb'
import cards from '../components/Cards.module.css'

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
  // A row per library, as Plex does, so each keeps its own card shape.
  const recent = useQueries({
    queries: (libraries.data ?? []).map((library) => ({
      queryKey: ['recentlyAdded', library.id],
      queryFn: async () =>
        (await api.browse.listRecentlyAdded({ libraryId: library.id })).items
    }))
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
          <PosterCard
            key={item.id}
            item={{ ...item, posterUrl: item.thumbUrl || item.posterUrl }}
          />
        ))}
      </Row>
      {(libraries.data ?? []).map((library, i) => (
        <Row key={library.id} title={`Recently added in ${library.name}`}>
          {(recent[i]?.data ?? []).map((item) => (
            <PosterCard key={item.id} item={item} />
          ))}
        </Row>
      ))}
    </>
  )
}
