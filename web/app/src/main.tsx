import '@weirhq/m3e/tokens.css'
import '@weirhq/m3e/styles.css'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { QueryClient } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createApi } from './api'
import { App } from './App'
import { Auth } from './gen/weir/api/v1alpha/auth_pb'
import { Reauth, reauthInterceptor } from './reauth'
import { Session } from './session'
import { authInterceptor } from './transport'

const baseUrl = window.location.origin
// Session calls go out without the auth interceptor, which depends on them.
const session = new Session(
  createClient(Auth, createConnectTransport({ baseUrl }))
)
await session.restore()

// Answers that won't change on asking again come straight back; other
// failures, such as a dropped connection, are retried as usual.
const final = [Code.NotFound, Code.PermissionDenied, Code.InvalidArgument]
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, err) =>
        failures < 3 && !final.includes(ConnectError.from(err).code)
    }
  }
})

const reauth = new Reauth()
const api = createApi(
  createConnectTransport({
    baseUrl,
    interceptors: [reauthInterceptor(reauth), authInterceptor(session)]
  })
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App context={{ api, session, reauth, queryClient }} />
  </StrictMode>
)
