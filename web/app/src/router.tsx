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
import { HomePage } from './pages/HomePage'
import { ItemPage } from './pages/ItemPage'
import { LibraryPage } from './pages/LibraryPage'
import { LoginPage } from './pages/LoginPage'
import { SearchPage } from './pages/SearchPage'
import { SetupPage } from './pages/SetupPage'
import type { Session } from './session'

export type RouterContext = {
  api: Api
  session: Session
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  appRoute.addChildren([homeRoute, libraryRoute, itemRoute, searchRoute])
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
