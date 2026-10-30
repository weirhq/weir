import { Session } from './session'
import { FakeAuth, memoryStorage } from './test/fakeAuth'
import { authInterceptor } from './transport'

it('survives a reload through the stored refresh token', async () => {
  const fake = new FakeAuth()
  const storage = memoryStorage()
  new Session(fake.client(), storage).signIn(fake.credentials())

  const reloaded = new Session(fake.client(), storage)
  expect(reloaded.signedIn).toBe(false)
  await reloaded.restore()
  expect(reloaded.signedIn).toBe(true)
  expect(reloaded.user?.displayName).toBe('Luna')
})

it('shares one refresh between concurrent callers', async () => {
  const fake = new FakeAuth()
  const storage = memoryStorage()
  new Session(fake.client(), storage).signIn(fake.credentials())

  const session = new Session(fake.client(), storage)
  const results = await Promise.all([
    session.refresh(),
    session.refresh(),
    session.refresh()
  ])
  expect(results).toEqual([true, true, true])
  expect(fake.refreshCalls).toBe(1)
})

it('signs out but remembers the device', async () => {
  const fake = new FakeAuth()
  const storage = memoryStorage()
  const session = new Session(fake.client(), storage)
  session.signIn(fake.credentials('luna', 'Luna', 'device-7'))

  await session.signOut()
  expect(session.signedIn).toBe(false)
  expect(fake.logouts).toBe(1)
  expect(session.deviceId).toBe('device-7')
  await session.restore()
  expect(session.signedIn).toBe(false)
})

it('forgets credentials the server no longer accepts', async () => {
  const fake = new FakeAuth()
  const storage = memoryStorage()
  storage.setItem(
    'weir.session',
    JSON.stringify({ refreshToken: 'revoked', deviceId: 'd' })
  )
  const session = new Session(fake.client(), storage)
  await session.restore()
  expect(session.signedIn).toBe(false)
  expect(session.deviceId).toBe('d')
})

it('retries once with fresh credentials after Unauthenticated', async () => {
  const fake = new FakeAuth()
  const session = new Session(fake.client(), memoryStorage())
  session.signIn(fake.credentials())
  const client = fake.client([authInterceptor(session)])

  fake.expireAccessTokens()
  const { user } = await client.getCurrentUser({})
  expect(user?.username).toBe('luna')
  expect(fake.refreshCalls).toBe(1)
})
