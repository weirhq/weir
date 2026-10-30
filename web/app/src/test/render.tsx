import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { createApi } from '../api'
import { App } from '../App'
import { Reauth, reauthInterceptor } from '../reauth'
import { Session } from '../session'
import { authInterceptor } from '../transport'
import { FakeAuth, memoryStorage } from './fakeAuth'
import { FakeAdmin } from './fakeAdmin'
import { FakeBrowse } from './fakeBrowse'

/** Renders the app at path against in-memory fakes. */
export function renderApp(
  fake: FakeAuth,
  path = '/',
  browse = new FakeBrowse(),
  admin = new FakeAdmin()
) {
  const session = new Session(fake.client(), memoryStorage())
  const reauth = new Reauth()
  const api = createApi(
    fake.transport(
      [reauthInterceptor(reauth), authInterceptor(session)],
      (r) => {
        browse.register(r)
        admin.register(r)
      }
    )
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  render(
    <App
      context={{ api, session, reauth, queryClient }}
      history={createMemoryHistory({ initialEntries: [path] })}
    />
  )
  return session
}

/** Renders the app signed in as the fake's admin. */
export function renderSignedIn(
  path: string,
  browse = new FakeBrowse(),
  { admin = new FakeAdmin(), fake = new FakeAuth() } = {}
) {
  const session = renderApp(fake, path, browse, admin)
  session.signIn(fake.credentials())
  return { fake, browse, admin, session }
}
