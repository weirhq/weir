import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeAuth } from './test/fakeAuth'
import { renderApp } from './test/render'
import { describeBrowser } from './device'

it('sends a fresh server to setup, then signs the new admin in', async () => {
  const fake = new FakeAuth()
  fake.needsBootstrap = true
  const session = renderApp(fake)
  const user = userEvent.setup()

  await screen.findByRole('heading', { name: 'Set up Weir' })
  await user.type(screen.getByLabelText('Username'), 'luna')
  await user.type(screen.getByLabelText('Display name (optional)'), 'Luna Nova')
  await user.type(screen.getByLabelText('Password'), 'short')
  expect(screen.getByText('At least 8 characters.')).toBeTruthy()
  await user.type(screen.getByLabelText('Password'), ' but longer')
  await user.type(screen.getByLabelText('Confirm password'), 'short but longer')
  await user.click(screen.getByRole('button', { name: 'Create account' }))

  await screen.findByRole('heading', { name: 'Recently added' })
  expect(screen.getByText('Luna Nova')).toBeTruthy()
  expect(session.signedIn).toBe(true)
})

it('asks for a password, reports a wrong one, and signs in and out', async () => {
  const fake = new FakeAuth()
  renderApp(fake)
  const user = userEvent.setup()

  await screen.findByRole('heading', { name: 'Sign in to Weir' })
  await user.type(screen.getByLabelText('Username'), 'luna')
  await user.type(screen.getByLabelText('Password'), 'wrong')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Wrong username or password.'
  )

  await user.clear(screen.getByLabelText('Password'))
  await user.type(screen.getByLabelText('Password'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Recently added' })

  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  await screen.findByRole('heading', { name: 'Sign in to Weir' })
  expect(fake.logouts).toBe(1)
})

it('keeps a configured server out of setup', async () => {
  renderApp(new FakeAuth(), '/setup')
  await screen.findByRole('heading', { name: 'Sign in to Weir' })
})

it.each([
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) Gecko/20100101 Firefox/146.0',
    'Firefox on macOS'
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0',
    'Edge on Windows'
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
    'Chrome on Linux'
  ],
  ['', 'Browser']
])('describes %s as %s', (ua, name) => {
  expect(describeBrowser(ua)).toBe(name)
})
