import type { Client } from '@connectrpc/connect'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory
} from '@tanstack/react-router'
import type { Auth } from './gen/weir/api/v1alpha/auth_pb'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SetupPage } from './pages/SetupPage'
import type { Session } from './session'

export type RouterContext = {
  auth: Client<typeof Auth>
  session: Session
  queryClient: QueryClient
}

export const setupStateKey = ['setupState'] as const

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // A fresh server sends everyone to first-run setup until an admin exists.
  beforeLoad: async ({ context, location }) => {
    const { needsBootstrap } = await context.queryClient.ensureQueryData({
      queryKey: setupStateKey,
      queryFn: () => context.auth.getSetupState({})
    })
    if (needsBootstrap && location.pathname !== '/setup')
      throw redirect({ to: '/setup' })
    if (!needsBootstrap && location.pathname === '/setup')
      throw redirect({ to: '/login' })
  },
  component: Outlet
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    if (!context.session.signedIn) throw redirect({ to: '/login' })
  },
  component: HomePage
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

const routeTree = rootRoute.addChildren([homeRoute, loginRoute, setupRoute])

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
