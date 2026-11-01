import { useQuery } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  useNavigate,
  useRouteContext
} from '@tanstack/react-router'
import {
  AppBarWithSearch,
  focusRing,
  IconButton,
  List,
  ListItem,
  Menu,
  MenuItem,
  NavigationBar,
  NavigationItem,
  NavigationRail,
  SearchBar,
  SnackbarHost,
  SnackbarProvider,
  StateLayer,
  type IconName
} from '@weirhq/m3e'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { sized } from '../art'
import { ItemKind, type ItemSummary } from '../gen/weir/api/v1alpha/browse_pb'
import { isSquare } from './PosterCard'
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

const kindNames: Partial<Record<ItemKind, string>> = {
  [ItemKind.MOVIE]: 'Film',
  [ItemKind.SHOW]: 'Show',
  [ItemKind.SEASON]: 'Season',
  [ItemKind.EPISODE]: 'Episode',
  [ItemKind.ARTIST]: 'Artist',
  [ItemKind.ALBUM]: 'Album',
  [ItemKind.TRACK]: 'Song'
}

/**
 * A match's second line: what it is, and what it belongs to or when it's
 * from, so two songs of one name tell their albums apart.
 */
function matchLine(item: ItemSummary): string {
  const kind =
    item.kind === ItemKind.EPISODE && item.indexNumber
      ? `Episode ${item.indexNumber}`
      : kindNames[item.kind]
  const where = item.parentTitle || (item.year ? String(item.year) : '')
  return [kind, where].filter(Boolean).join(' · ')
}

/** "Luna Nova" is "LN". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * What every signed-in page shares: a search bar with the account at its
 * end, navigation (a rail beside wider windows, a bar under narrow ones),
 * and the mini-player.
 */
export function AppShell() {
  const { api, session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const user = useSyncExternalStore(session.subscribe, () => session.user)
  const libraries = useQuery({
    queryKey: librariesKey,
    queryFn: async () => (await api.browse.listVisibleLibraries({})).libraries
  })

  // Search: matches show under the bar as you type; Enter goes to them all.
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])
  const suggestions = useQuery({
    queryKey: ['suggest', settled],
    enabled: settled.length >= 2,
    queryFn: async () =>
      (await api.browse.search({ query: settled, limit: 8 })).items
  })
  function search(q: string) {
    setSearching(false)
    if (q.trim()) void navigate({ to: '/search', search: { q: q.trim() } })
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
  const admin = user?.role === Role.ADMIN

  async function signOut() {
    await session.signOut()
    await navigate({ to: '/login' })
  }

  const name = user?.displayName || user?.username || ''
  const account = (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          className={`${styles.avatar} ${focusRing}`}
          aria-label={`Account: ${name}`}
        >
          <StateLayer />
          {initials(name)}
        </button>
      }
    >
      <p className={styles.menuName} aria-hidden="true">
        {name}
      </p>
      {admin && (
        <MenuItem onSelect={() => void navigate({ to: '/admin' })}>
          Settings
        </MenuItem>
      )}
      <MenuItem onSelect={() => void signOut()}>Sign out</MenuItem>
    </Menu>
  )
  const matches = settled.length >= 2 ? (suggestions.data ?? []) : []

  return (
    <SnackbarProvider>
      <div className={styles.shell}>
        {wide && (
          <NavigationRail
            aria-label="Main"
            className={styles.rail}
            expanded={railOpen}
            header={
              <>
                <IconButton
                  icon={railOpen ? 'menu_open' : 'menu'}
                  label="Show labels"
                  aria-expanded={railOpen}
                  onClick={() => toggleRail(!railOpen)}
                />
                <Link to="/" className={styles.brand}>
                  Weir
                </Link>
              </>
            }
          >
            {destinations}
            {admin && (
              <NavigationItem icon="settings" label="Settings">
                <Link to="/admin" activeProps={{ 'aria-current': 'page' }} />
              </NavigationItem>
            )}
          </NavigationRail>
        )}
        <div className={styles.column}>
          <AppBarWithSearch className={styles.bar}>
            <SearchBar
              value={query}
              onValueChange={(q) => {
                setQuery(q)
                setSearching(q.trim().length >= 2)
              }}
              onSearch={search}
              placeholder="Search"
              expanded={searching && matches.length > 0}
              onExpandedChange={setSearching}
              expandsTo={wide ? 'docked' : 'fullScreen'}
              trailing={account}
            >
              <List>
                {matches.map((item) => (
                  <ListItem
                    key={item.id}
                    asChild
                    leading={
                      <span
                        className={
                          isSquare(item)
                            ? `${styles.thumb} ${styles.square}`
                            : styles.thumb
                        }
                      >
                        {(item.posterUrl || item.thumbUrl) && (
                          <img
                            src={sized(item.posterUrl || item.thumbUrl, 160)}
                            alt=""
                          />
                        )}
                      </span>
                    }
                    headline={item.title}
                    supporting={matchLine(item)}
                  >
                    <Link
                      to="/item/$itemId"
                      params={{ itemId: item.id }}
                      onClick={() => {
                        setSearching(false)
                        setQuery('')
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </SearchBar>
          </AppBarWithSearch>
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
        <ReauthDialog />
      </div>
    </SnackbarProvider>
  )
}
