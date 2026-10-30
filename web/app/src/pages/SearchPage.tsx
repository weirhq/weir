import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { PosterCard } from '../components/PosterCard'
import cards from '../components/Cards.module.css'
import { searchRoute } from '../router'

export function SearchPage() {
  const { q } = searchRoute.useSearch()
  const { api } = useRouteContext({ from: '__root__' })
  const results = useQuery({
    queryKey: ['search', q],
    enabled: q !== '',
    queryFn: async () =>
      (await api.browse.search({ query: q, limit: 60 })).items
  })
  return (
    <section className={cards.section}>
      <h1 className={cards.heading}>Results for “{q}”</h1>
      {results.isSuccess && results.data.length === 0 && (
        <p className={cards.empty}>Nothing matches.</p>
      )}
      <div className={cards.grid}>
        {(results.data ?? []).map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
