import { Code, ConnectError } from '@connectrpc/connect'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { PageLoading } from '../components/PageLoading'
import { PersonPhoto } from '../components/PersonCard'
import { PosterCard } from '../components/PosterCard'
import cards from '../components/Cards.module.css'
import { errorMessage } from '../errors'
import { personRoute } from '../router'
import styles from './PersonPage.module.css'

/** Someone from a cast: their photo, and what they're in that you have. */
export function PersonPage() {
  const { personId } = personRoute.useParams()
  const { api } = useRouteContext({ from: '__root__' })
  const person = useQuery({
    queryKey: ['person', personId],
    queryFn: () => api.browse.getPerson({ id: personId })
  })
  if (person.isPending) return <PageLoading />
  if (person.isError)
    return (
      <p className={cards.empty} role="alert">
        {ConnectError.from(person.error).code === Code.NotFound
          ? 'This person isn’t in anything you have.'
          : errorMessage(person.error)}
      </p>
    )
  const { name, photoUrl, credits } = person.data
  return (
    <article>
      <header className={styles.head}>
        <PersonPhoto name={name} photoUrl={photoUrl} size={160} />
        <div>
          <h1 className={styles.name}>{name}</h1>
          <p className={styles.count}>
            In {credits.length} {credits.length === 1 ? 'title' : 'titles'} you
            have
          </p>
        </div>
      </header>
      <div className={cards.grid}>
        {credits.map(({ item, role }) => (
          <div key={item!.id} className={styles.credit}>
            <PosterCard item={item!} />
            {role && <span className={styles.role}>as {role}</span>}
          </div>
        ))}
      </div>
    </article>
  )
}
