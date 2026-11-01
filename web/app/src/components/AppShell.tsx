import { useQuery } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  useNavigate,
  useRouteContext
} from '@tanstack/react-router'
import {
  Button,
  IconButton,
  NavigationBar,
  NavigationItem,
  NavigationRail,
  SnackbarHost,
  SnackbarProvider,
  TopAppBar,
  type IconName
} from '@weirhq/m3e'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { LibraryKind } from '../gen/weir/api/v1alpha/library_pb'
import { Role } from '../gen/weir/api/v1alpha/user_pb'
import { useMediaQuery } from '../media'
import { MiniPlayer } from '../player/MiniPlayer'
import { ReauthDialog } from './ReauthDialog'
import styles from './AppShell.module.css'

export const librariesKey = ['libraries'] as const

const railKey = 'weir.rail'

const kindIcons: Record<LibraryKind, IconName> = {
  [LibraryKind.UNSPECIFIED]: 'home',
  [LibraryKind.MOVIES]: 'movie',
  [LibraryKind.SHOWS]: 'tv',
  [LibraryKind.MUSIC]: 'music_note'
}

/**
 * What every signed-in page shares: the top app bar with search and the
 * account, navigation (a rail beside wider windows, a bar under narrow
 * ones), and the mini-player.
 */
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

  // Where to go: a rail beside wider windows, a bar under narrow ones.
  const wide = useMediaQuery('(min-width: 600px)')
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem(railKey) === 'open'
    } catch {
      return false
    }
  })
  function toggleRail(open: boolean) {
    setRailOpen(open)
    try {
      localStorage.setItem(railKey, open ? 'open' : 'closed')
    } catch {
      // Remembering it is a convenience.
    }
  }
  const destinations = (
    <>
      <NavigationItem icon="home" label="Home">
        <Link
          to="/"
          activeOptions={{ exact: true }}
          activeProps={{ 'aria-current': 'page' }}
        />
      </NavigationItem>
      {libraries.data?.map((l) => (
        <NavigationItem key={l.id} icon={kindIcons[l.kind]} label={l.name}>
          <Link
            to="/library/$libraryId"
            params={{ libraryId: l.id }}
            activeProps={{ 'aria-current': 'page' }}
          />
        </NavigationItem>
      ))}
      <NavigationItem icon="playlist_play" label="Playlists">
        <Link to="/playlists" activeProps={{ 'aria-current': 'page' }} />
      </NavigationItem>
    </>
  )

  async function signOut() {
    await session.signOut()
    await navigate({ to: '/login' })
  }

  return (
    <SnackbarProvider>
      <div className={styles.shell}>
        <TopAppBar
          className={styles.bar}
          scrollBehavior="pinned"
          title={
            <Link to="/" className={styles.brand}>
              Weir
            </Link>
          }
          actions={
            <>
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
                {user?.role === Role.ADMIN && (
                  <Link
                    to="/admin"
                    className={styles.navLink}
                    activeProps={{ 'aria-current': 'page' }}
                  >
                    Settings
                  </Link>
                )}
                <span>{user?.displayName}</span>
                <Button variant="text" onClick={signOut}>
                  Sign out
                </Button>
              </div>
            </>
          }
        />
        <div className={styles.body}>
          {wide && (
            <NavigationRail
              aria-label="Main"
              className={styles.rail}
              expanded={railOpen}
              header={
                <IconButton
                  icon={railOpen ? 'menu_open' : 'menu'}
                  label="Show labels"
                  aria-expanded={railOpen}
                  onClick={() => toggleRail(!railOpen)}
                />
              }
            >
              {destinations}
            </NavigationRail>
          )}
          <div className={styles.column}>
            <main className={styles.main}>
              <Outlet />
            </main>
            <div className={styles.foot}>
              <SnackbarHost className={styles.snackbars} />
              <MiniPlayer />
              {!wide && (
                <NavigationBar aria-label="Main">{destinations}</NavigationBar>
              )}
            </div>
          </div>
        </div>
        <ReauthDialog />
      </div>
    </SnackbarProvider>
  )
}
