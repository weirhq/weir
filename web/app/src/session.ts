import type { Client } from '@connectrpc/connect'
import type { Auth, Credentials } from './gen/weir/api/v1alpha/auth_pb'
import type { User } from './gen/weir/api/v1alpha/user_pb'

const STORAGE_KEY = 'weir.session'
// Refresh this long before the access token expires.
const EXPIRY_MARGIN_MS = 30_000

type Stored = { refreshToken?: string; deviceId?: string }

/**
 * The signed-in user's credentials. The access token lives only in memory;
 * the refresh token and device id are kept in localStorage so a reload stays
 * signed in on the same device.
 */
export class Session {
  #auth: Client<typeof Auth>
  #storage: Storage | undefined
  #credentials: Credentials | undefined
  #refreshing: Promise<boolean> | undefined
  #listeners = new Set<() => void>()

  constructor(
    auth: Client<typeof Auth>,
    storage: Storage | undefined = globalThis.localStorage
  ) {
    this.#auth = auth
    this.#storage = storage
  }

  get user(): User | undefined {
    return this.#credentials?.user
  }

  get signedIn(): boolean {
    return this.#credentials !== undefined
  }

  /** The device id from this browser's last sign-in, so it isn't registered twice. */
  get deviceId(): string {
    return this.#read().deviceId ?? ''
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  signIn(credentials: Credentials): void {
    this.#credentials = credentials
    this.#write({
      refreshToken: credentials.refreshToken,
      deviceId: credentials.deviceId
    })
    this.#notify()
  }

  async signOut(): Promise<void> {
    const token = this.#credentials?.accessToken
    this.#forget()
    if (token) {
      // Best effort: the refresh token is already gone from this browser.
      await this.#auth
        .logout({}, { headers: { Authorization: `Bearer ${token}` } })
        .catch(() => undefined)
    }
  }

  /** Signs in again from a stored refresh token, if there is one. */
  async restore(): Promise<void> {
    if (this.#read().refreshToken) await this.refresh()
  }

  /** A current access token, refreshing first if it is about to expire. */
  async accessToken(): Promise<string | undefined> {
    const expires = this.#credentials?.accessTokenExpiresAt
    if (
      expires &&
      Number(expires.seconds) * 1000 - EXPIRY_MARGIN_MS > Date.now()
    ) {
      return this.#credentials?.accessToken
    }
    if (!(await this.refresh())) return undefined
    return this.#credentials?.accessToken
  }

  /**
   * Exchanges the refresh token for new credentials. Concurrent callers share
   * one request, since each refresh token works only once.
   */
  refresh(): Promise<boolean> {
    this.#refreshing ??= this.#doRefresh().finally(
      () => (this.#refreshing = undefined)
    )
    return this.#refreshing
  }

  async #doRefresh(): Promise<boolean> {
    const refreshToken = this.#read().refreshToken
    if (!refreshToken) return false
    try {
      const { credentials } = await this.#auth.refresh({ refreshToken })
      if (!credentials) throw new Error('refresh returned no credentials')
      this.signIn(credentials)
      return true
    } catch {
      this.#forget()
      return false
    }
  }

  #forget(): void {
    const wasSignedIn = this.signedIn
    this.#credentials = undefined
    this.#write({ deviceId: this.deviceId })
    if (wasSignedIn) this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  #read(): Stored {
    try {
      return JSON.parse(this.#storage?.getItem(STORAGE_KEY) ?? '{}') as Stored
    } catch {
      return {}
    }
  }

  #write(stored: Stored): void {
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // Storage can be unavailable (private browsing); the session then lasts
      // only as long as the page.
    }
  }
}
