import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import { Auth } from './gen/weir/api/v1alpha/auth_pb'
import type { Session } from './session'

// Auth methods that work without an access token.
const PUBLIC_METHODS = new Set([
  'GetSetupState',
  'Bootstrap',
  'Login',
  'Refresh'
])

/**
 * Adds the session's access token to every call that needs one, and retries
 * once with fresh credentials when the server says the token is no good.
 */
export function authInterceptor(session: Session): Interceptor {
  return (next) => async (req) => {
    if (
      req.service.typeName === Auth.typeName &&
      PUBLIC_METHODS.has(req.method.name)
    ) {
      return next(req)
    }
    const token = await session.accessToken()
    if (token) req.header.set('Authorization', `Bearer ${token}`)
    try {
      return await next(req)
    } catch (err) {
      if (!token || ConnectError.from(err).code !== Code.Unauthenticated)
        throw err
      if (!(await session.refresh())) throw err
      req.header.set('Authorization', `Bearer ${await session.accessToken()}`)
      return next(req)
    }
  }
}
