import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'

// What the server says when an admin call needs a recent password.
const reauthMessage = 'sign in again to continue'

/**
 * Admin calls need a password entered in the last 10 minutes. When one is
 * refused for that, this asks the user to sign in again (through whatever
 * dialog is listening) and reports whether they did.
 */
export class Reauth {
  #pending: Promise<boolean> | undefined
  #settle: ((ok: boolean) => void) | undefined
  #listeners = new Set<() => void>()

  get asking(): boolean {
    return this.#settle !== undefined
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Concurrent refusals share one prompt. */
  ask(): Promise<boolean> {
    this.#pending ??= new Promise<boolean>((resolve) => {
      this.#settle = resolve
      this.#notify()
    })
    return this.#pending
  }

  /** The user signed in again (true) or gave up (false). */
  done(ok: boolean): void {
    this.#settle?.(ok)
    this.#settle = undefined
    this.#pending = undefined
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

export function needsReauth(err: unknown): boolean {
  const e = ConnectError.from(err)
  return e.code === Code.PermissionDenied && e.rawMessage === reauthMessage
}

/**
 * Retries a call once the user has signed in again. Goes before the auth
 * interceptor, so the retry carries the new access token.
 */
export function reauthInterceptor(reauth: Reauth): Interceptor {
  return (next) => async (req) => {
    try {
      return await next(req)
    } catch (err) {
      if (!needsReauth(err) || !(await reauth.ask())) throw err
      return next(req)
    }
  }
}
