import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory
} from '@tanstack/react-router'
import type { Api } from './api'
import { AppShell } from './components/AppShell'
import { Role } from './gen/weir/api/v1alpha/user_pb'
import { AdminLayout } from './pages/admin/AdminLayout'
import { LibrariesPage as AdminLibrariesPage } from './pages/admin/LibrariesPage'
import { StatusPage } from './pages/admin/StatusPage'
import { UsersPage } from './pages/admin/UsersPage'
import { HomePage } from './pages/HomePage'
import { ItemPage } from './pages/ItemPage'
import { LibraryPage } from './pages/LibraryPage'
import { PlayerPage } from './player/PlayerPage'
import { LoginPage } from './pages/LoginPage'
import { PlaylistPage } from './pages/PlaylistPage'
import { PlaylistsPage } from './pages/PlaylistsPage'
import { SearchPage } from './pages/SearchPage'
import { SetupPage } from './pages/SetupPage'
import type { Reauth } from './reauth'
import type { Session } from './session'

export type RouterContext = {
  api: Api
  session: Session
  reauth: Reauth
  queryClient: QueryClient
}

export const setupStateKey = ['setupState'] as const

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // A fresh server sends everyone to first-run setup until an admin exists.
  beforeLoad: async ({ context, location }) => {
    const { needsBootstrap } = await context.queryClient.ensureQueryData({
      queryKey: setupStateKey,
      queryFn: () => context.api.auth.getSetupState({})
    })
    if (needsBootstrap && location.pathname !== '/setup')
      throw redirect({ to: '/setup' })
    if (!needsBootstrap && location.pathname === '/setup')
      throw redirect({ to: '/login' })
  },
  component: Outlet
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: ({ context }) => {
    if (context.session.signedIn) throw redirect({ to: '/' })
  },
  component: LoginPage
})

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: SetupPage
})

// Everything past sign-in shares the app's header.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: ({ context }) => {
    if (!context.session.signedIn) throw redirect({ to: '/login' })
  },
  component: AppShell
})

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: HomePage
})

export const libraryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/library/$libraryId',
  component: LibraryPage
})

export const itemRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/item/$itemId',
  component: ItemPage
})

export const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>): { q: string } => ({
    q: typeof search.q === 'string' ? search.q : ''
  }),
  component: SearchPage
})

const playlistsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playlists',
  component: PlaylistsPage
})

export const playlistRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playlist/$playlistId',
  component: PlaylistPage
})

// Server settings, for admins only; the server checks again on every call.
const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  beforeLoad: ({ context }) => {
    if (context.session.user?.role !== Role.ADMIN) throw redirect({ to: '/' })
  },
  component: AdminLayout
})

const adminLibrariesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: AdminLibrariesPage
})

const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  component: UsersPage
})

const adminStatusRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/status',
  component: StatusPage
})

// Full screen, without the app's header, but still signed in.
export const playRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/play/$itemId',
  beforeLoad: ({ context }) => {
    if (!context.session.signedIn) throw redirect({ to: '/login' })
  },
  validateSearch: (search: Record<string, unknown>): { version?: string } =>
    typeof search.version === 'string' ? { version: search.version } : {},
  component: PlayerPage
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  playRoute,
  appRoute.addChildren([
    homeRoute,
    libraryRoute,
    itemRoute,
    searchRoute,
    playlistsRoute,
    playlistRoute,
    adminRoute.addChildren([
      adminLibrariesRoute,
      adminUsersRoute,
      adminStatusRoute
    ])
  ])
])

export function createAppRouter(
  context: RouterContext,
  history?: RouterHistory
) {
  return createRouter({ routeTree, context, history })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
