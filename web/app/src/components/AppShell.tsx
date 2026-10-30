import { useQuery } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  useNavigate,
  useRouteContext
} from '@tanstack/react-router'
import { Button } from '@weirhq/ui'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import styles from './AppShell.module.css'

export const librariesKey = ['libraries'] as const

/** The header every signed-in page shares: libraries, search, account. */
export function AppShell() {
  const { api, session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const user = useSyncExternalStore(session.subscribe, () => session.user)
  const [query, setQuery] = useState('')
  const libraries = useQuery({
    queryKey: librariesKey,
    queryFn: async () => (await api.browse.listVisibleLibraries({})).libraries
  })

  function search(e: FormEvent) {
    e.preventDefault()
    if (query.trim())
      void navigate({ to: '/search', search: { q: query.trim() } })
  }

  async function signOut() {
    await session.signOut()
    await navigate({ to: '/login' })
  }

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link to="/" className={styles.brand}>
          Weir
        </Link>
        <nav className={styles.nav} aria-label="Libraries">
          {libraries.data?.map((l) => (
            <Link
              key={l.id}
              to="/library/$libraryId"
              params={{ libraryId: l.id }}
              className={styles.navLink}
              activeProps={{ 'aria-current': 'page' }}
            >
              {l.name}
            </Link>
          ))}
        </nav>
        <form role="search" className={styles.search} onSubmit={search}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search"
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <div className={styles.user}>
          <span>{user?.displayName}</span>
          <Button variant="text" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
