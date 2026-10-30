import { create } from '@bufbuild/protobuf'
import { timestampFromMs } from '@bufbuild/protobuf/wkt'
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type ConnectRouter,
  type Interceptor
} from '@connectrpc/connect'
import { Auth, CredentialsSchema } from '../gen/weir/api/v1alpha/auth_pb'
import { Role, UserSchema } from '../gen/weir/api/v1alpha/user_pb'

/** An in-memory Auth server with one account, for tests. */
export class FakeAuth {
  needsBootstrap = false
  password = 'correct horse'
  refreshCalls = 0
  logins = 0
  role = Role.ADMIN
  logouts = 0
  #issued = 0
  #validRefresh = new Set<string>()
  #validAccess = new Set<string>()

  credentials(username = 'luna', displayName = 'Luna', deviceId = 'device-1') {
    const n = ++this.#issued
    const accessToken = `access-${n}`
    const refreshToken = `refresh-${n}`
    this.#validAccess.add(accessToken)
    this.#validRefresh.add(refreshToken)
    return create(CredentialsSchema, {
      accessToken,
      accessTokenExpiresAt: timestampFromMs(Date.now() + 15 * 60_000),
      refreshToken,
      deviceId,
      user: create(UserSchema, {
        id: 'u1',
        username,
        displayName,
        role: this.role
      })
    })
  }

  /** Makes every access token issued so far invalid, as if they expired. */
  expireAccessTokens() {
    this.#validAccess.clear()
  }

  /** A transport serving this fake Auth, plus whatever `more` registers. */
  transport(
    interceptors: Interceptor[] = [],
    more?: (router: ConnectRouter) => void
  ) {
    return createRouterTransport(
      (router) => {
        more?.(router)
        const { service } = router
        service(Auth, {
          getSetupState: () => ({ needsBootstrap: this.needsBootstrap }),
          bootstrap: (req) => {
            this.needsBootstrap = false
            return {
              credentials: this.credentials(
                req.username,
                req.displayName || req.username
              )
            }
          },
          login: (req) => {
            if (req.password !== this.password)
              throw new ConnectError(
                'wrong username or password',
                Code.Unauthenticated
              )
            this.logins++
            return {
              credentials: this.credentials(
                req.username,
                'Luna',
                req.device?.deviceId || 'device-1'
              )
            }
          },
          refresh: (req) => {
            this.refreshCalls++
            if (!this.#validRefresh.delete(req.refreshToken)) {
              throw new ConnectError(
                'invalid or expired refresh token',
                Code.Unauthenticated
              )
            }
            return { credentials: this.credentials() }
          },
          logout: () => {
            this.logouts++
            return {}
          },
          getCurrentUser: (_req, ctx) => {
            const token =
              ctx.requestHeader.get('Authorization')?.replace('Bearer ', '') ??
              ''
            if (!this.#validAccess.has(token))
              throw new ConnectError(
                'invalid or expired access token',
                Code.Unauthenticated
              )
            return {
              user: create(UserSchema, {
                id: 'u1',
                username: 'luna',
                displayName: 'Luna'
              })
            }
          }
        })
      },
      { transport: { interceptors } }
    )
  }

  client(interceptors: Interceptor[] = []) {
    return createClient(Auth, this.transport(interceptors))
  }
}

export function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v)
  }
}
