import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { createApi } from '../api'
import { App } from '../App'
import { Session } from '../session'
import { authInterceptor } from '../transport'
import { FakeAuth, memoryStorage } from './fakeAuth'
import { FakeBrowse } from './fakeBrowse'

/** Renders the app at path against in-memory fakes. */
export function renderApp(
  fake: FakeAuth,
  path = '/',
  browse = new FakeBrowse()
) {
  const session = new Session(fake.client(), memoryStorage())
  const api = createApi(
    fake.transport([authInterceptor(session)], (r) => browse.register(r))
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  render(
    <App
      context={{ api, session, queryClient }}
      history={createMemoryHistory({ initialEntries: [path] })}
    />
  )
  return session
}

/** Renders the app signed in as the fake's admin. */
export function renderSignedIn(path: string, browse = new FakeBrowse()) {
  const fake = new FakeAuth()
  const session = renderApp(fake, path, browse)
  session.signIn(fake.credentials())
  return { fake, browse, session }
}
