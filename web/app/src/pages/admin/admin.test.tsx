import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Role } from '../../gen/weir/api/v1alpha/user_pb'
import { FakeAdmin } from '../../test/fakeAdmin'
import { FakeAuth } from '../../test/fakeAuth'
import { FakeBrowse } from '../../test/fakeBrowse'
import { renderSignedIn } from '../../test/render'

const card = (name: string) =>
  screen.getByRole('heading', { name }).closest('li')!

it('keeps members out of server settings', async () => {
  const fake = new FakeAuth()
  fake.role = Role.MEMBER
  renderSignedIn('/admin', new FakeBrowse(), { fake })
  await screen.findByRole('region', { name: 'Recently added' })
  expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
})

it('lists libraries with their scans, and scans, edits, adds and deletes', async () => {
  const user = userEvent.setup()
  const { admin } = renderSignedIn('/')
  await user.click(await screen.findByRole('link', { name: 'Settings' }))
  await screen.findByRole('heading', { name: 'Films' })
  expect(within(card('TV')).getByText('Scanning…')).toBeTruthy()
  expect(within(card('Films')).getByText(/^Last scanned /)).toBeTruthy()
  expect(within(card('Music')).getByText('/media/more-music')).toBeTruthy()

  await user.click(
    within(card('Films')).getByRole('button', { name: 'Scan now' })
  )
  await within(card('Films')).findByText('Scanning…')
  expect(admin.scans).toEqual(['films'])

  await user.click(within(card('Music')).getByRole('button', { name: 'Edit' }))
  const folders = screen.getByLabelText('Folders, one per line')
  await user.clear(folders)
  await user.type(folders, '/media/music{Enter}  {Enter}/media/lossless')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('/media/lossless')
  expect(admin.libraryUpdates[0]).toMatchObject({
    id: 'music',
    name: 'Music',
    paths: ['/media/music', '/media/lossless'],
    updateMask: { paths: ['name', 'paths'] }
  })

  await user.click(screen.getByRole('button', { name: 'Add library' }))
  // The form says where folders may go, before anyone gets it wrong.
  const hint = screen.getByText(/Folders must be inside/)
  expect(hint.textContent).toBe(
    'Folders must be inside /media. Change these in the server’s library_paths setting.'
  )
  expect(
    screen
      .getByLabelText('Folders, one per line')
      .getAttribute('aria-describedby')
  ).toBe(hint.id)
  await user.type(screen.getByLabelText('Name'), 'Concerts')
  await user.selectOptions(screen.getByLabelText('Kind'), 'Music')
  await user.type(
    screen.getByLabelText('Folders, one per line'),
    '/media/concerts'
  )
  await user.click(screen.getByRole('button', { name: 'Add library' }))
  await screen.findByRole('heading', { name: 'Concerts' })
  expect(within(card('Concerts')).getByText('Scanning…')).toBeTruthy()
  // The header's library list picks it up too.
  expect(admin.libraries.at(-1)).toMatchObject({
    name: 'Concerts',
    paths: ['/media/concerts']
  })

  await user.click(within(card('TV')).getByRole('button', { name: 'Delete' }))
  const dialog = screen.getByRole('dialog', { name: 'Delete “TV”?' })
  expect(dialog.textContent).toContain('Files on disk are not touched.')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await vi.waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'TV' })).toBeNull()
  )
  expect(admin.libraries.map((l) => l.id)).not.toContain('tv')
})

it('asks for the password again when the sign-in is too old', async () => {
  const user = userEvent.setup()
  const fake = new FakeAuth()
  const admin = new FakeAdmin()
  admin.requireReauth(fake)
  renderSignedIn('/admin', new FakeBrowse(), { fake, admin })

  // Both of the page's calls are refused; one prompt covers them.
  const dialog = await screen.findByRole('dialog', {
    name: 'Confirm it’s you'
  })
  await user.type(within(dialog).getByLabelText('Password'), 'wrong')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'Wrong username or password.'
  )
  const password = within(dialog).getByLabelText('Password')
  await user.clear(password)
  await user.type(password, fake.password)
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))

  await screen.findByRole('heading', { name: 'Films' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fake.logins).toBe(1)
})

it('shows the refusal when the password prompt is cancelled', async () => {
  const user = userEvent.setup()
  const fake = new FakeAuth()
  const admin = new FakeAdmin()
  admin.requireReauth(fake)
  renderSignedIn('/admin/users', new FakeBrowse(), { fake, admin })
  const dialog = await screen.findByRole('dialog', {
    name: 'Confirm it’s you'
  })
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Sign in again to continue.'
  )
})

it('manages users and what members may do in each library', async () => {
  const user = userEvent.setup()
  const { admin } = renderSignedIn('/admin/users')
  await screen.findByRole('heading', { name: 'Ana' })
  expect(within(card('Luna')).getByText('luna · Admin · you')).toBeTruthy()
  // You can't delete yourself.
  expect(
    within(card('Luna')).queryByRole('button', { name: 'Delete' })
  ).toBeNull()

  await user.click(within(card('Ana')).getByRole('button', { name: 'Edit' }))
  const ana = card('Ana')
  // Ana may browse and play Films.
  const box = (name: string) =>
    within(ana).findByRole('checkbox', { name }) as Promise<HTMLInputElement>
  expect((await box('Browse Films')).checked).toBe(true)
  expect((await box('Play Films')).checked).toBe(true)
  expect((await box('Browse TV')).checked).toBe(false)

  // Play needs browse; taking browse away takes the rest.
  await user.click(await box('Play TV'))
  expect((await box('Browse TV')).checked).toBe(true)
  await user.click(await box('Browse Films'))
  expect((await box('Play Films')).checked).toBe(false)
  await user.click(within(ana).getByRole('button', { name: 'Save access' }))
  await within(ana).findByText('Access saved')
  expect(admin.access.u2).toEqual([
    expect.objectContaining({
      libraryId: 'tv',
      view: true,
      play: true,
      manage: false
    })
  ])

  await user.selectOptions(within(ana).getByLabelText('Role'), 'Admin')
  await user.type(within(ana).getByLabelText('New password'), 'new secret')
  expect(
    within(ana).getByText('Setting a password signs them out on every device.')
  ).toBeTruthy()
  await user.click(within(ana).getByRole('button', { name: 'Save' }))
  await within(card('Ana')).findByText('ana · Admin')
  expect(admin.userUpdates[0]).toMatchObject({
    id: 'u2',
    role: Role.ADMIN,
    password: 'new secret',
    updateMask: { paths: ['role', 'password'] }
  })

  await user.click(screen.getByRole('button', { name: 'Add user' }))
  await user.type(screen.getByLabelText('Username'), 'ana')
  await user.type(screen.getByLabelText('Password'), 'pw')
  await user.click(screen.getByRole('button', { name: 'Add user' }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    'That username is taken.'
  )
  const username = screen.getByLabelText('Username')
  await user.clear(username)
  await user.type(username, 'pearl')
  await user.type(screen.getByLabelText('Display name'), 'Pearl')
  await user.click(screen.getByRole('button', { name: 'Add user' }))
  await screen.findByRole('heading', { name: 'Pearl' })
  expect(within(card('Pearl')).getByText('pearl · Member')).toBeTruthy()

  await user.click(
    within(card('Pearl')).getByRole('button', { name: 'Delete' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Delete Pearl?' })
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await vi.waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Pearl' })).toBeNull()
  )
  expect(admin.users.map((u) => u.username)).toEqual(['luna', 'ana'])
})

it('shows the engine and the recent jobs', async () => {
  renderSignedIn('/admin/status')
  const engine = await screen.findByRole('region', { name: 'Engine' })
  expect((await within(engine).findByRole('status')).textContent).toBe(
    'Running'
  )
  expect(engine.textContent).toContain('Playback sessions1 of 4')
  expect(engine.textContent).toContain(
    'None in use; converting on the processor'
  )

  const jobs = screen.getByRole('region', { name: 'Recent jobs' })
  await within(jobs).findByText('TV')
  const rows = within(jobs)
    .getAllByRole('row')
    .slice(1)
    .map((r) =>
      within(r)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((c) => c.textContent)
    )
  expect(rows).toEqual([
    ['Scan', 'TV', 'Running'],
    [
      'Metadata refresh',
      'Music',
      'Failed (attempt 3)musicbrainz: 503 Service Unavailable'
    ],
    ['Scan', 'Films', 'Done']
  ])
})

it('says why the server won’t use the engine', async () => {
  const admin = new FakeAdmin()
  admin.healthy = false
  admin.engineVersion = '0.2.0'
  admin.problem =
    'weir-engine 0.2.0 doesn’t work with weir-server 0.1.0, which needs an engine from 0.1.0 up to but not including 0.2.0'
  renderSignedIn('/admin/status', new FakeBrowse(), { admin })
  const engine = await screen.findByRole('region', { name: 'Engine' })
  expect((await within(engine).findByRole('status')).textContent).toBe(
    'Not compatible'
  )
  expect(within(engine).getByRole('alert').textContent).toBe(admin.problem)
})
