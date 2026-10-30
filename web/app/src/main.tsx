import '@weirhq/ui/tokens.css'
import '@weirhq/ui/styles.css'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { QueryClient } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Auth } from './gen/weir/api/v1alpha/auth_pb'
import { Session } from './session'
import { authInterceptor } from './transport'

const baseUrl = window.location.origin
// Session calls go out without the auth interceptor, which depends on them.
const session = new Session(
  createClient(Auth, createConnectTransport({ baseUrl }))
)
await session.restore()

const auth = createClient(
  Auth,
  createConnectTransport({ baseUrl, interceptors: [authInterceptor(session)] })
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App context={{ auth, session, queryClient: new QueryClient() }} />
  </StrictMode>
)
