import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderSignedIn } from '../test/render'

it('shows continue watching, recently added and the libraries', async () => {
  renderSignedIn('/')
  const resume = await screen.findByRole('region', {
    name: 'Continue watching'
  })
  expect(within(resume).getByText('Arrival')).toBeTruthy()
  // Recently added comes a row per library, albums with square covers.
  const titles = async (library: string) =>
    within(
      await screen.findByRole('region', {
        name: `Recently added in ${library}`
      })
    )
      .getAllByRole('link')
      .map((a) => a.textContent)
  expect(await titles('Films')).toEqual([
    expect.stringContaining('Arrival'),
    expect.stringContaining('Zodiac')
  ])
  expect(await titles('TV')).toEqual([expect.stringContaining('Severance')])
  expect(await titles('Music')).toEqual([
    expect.stringContaining('Music Has the Right to Children')
  ])
  const album = screen
    .getByRole('region', { name: 'Recently added in Music' })
    .querySelector('a > div')!
  expect(album.className).toMatch(/square/)
  const nav = screen.getByRole('navigation', { name: 'Main' })
  // What each link says, leaving out its icon, which isn't read out.
  const label = (a: HTMLElement) => {
    const shown = a.cloneNode(true) as HTMLElement
    shown.querySelectorAll('[aria-hidden]').forEach((e) => e.remove())
    return shown.textContent
  }
  expect(within(nav).getAllByRole('link').map(label)).toEqual([
    'Home',
    'Films',
    'TV',
    'Music',
    'Playlists'
  ])
})

it('lists a library as a grid', async () => {
  renderSignedIn('/library/films')
  await screen.findByRole('heading', { name: 'Films' })
  expect(await screen.findByText('Zodiac')).toBeTruthy()
  const poster = screen.getByText('Arrival').closest('a')!.querySelector('img')!
  expect(poster.getAttribute('srcset')).toContain(
    '/media/artwork/arrival/poster?sig=x&w=160 160w'
  )
})

it('shows artists square', async () => {
  renderSignedIn('/library/music')
  const artist = await screen.findByText('Boards of Canada')
  expect(artist.closest('a')!.querySelector('div')!.className).toMatch(/square/)
})

it('shows a film with its facts, cast and file, and marks it watched', async () => {
  const { browse } = renderSignedIn('/item/arrival')
  await screen.findByRole('heading', { name: 'Arrival', level: 1 })
  expect(
    screen.getByText(
      '2016 · PG-13 · 1 h 56 min · ★ 7.9 · Drama, Science Fiction'
    )
  ).toBeTruthy()
  expect(screen.getByText('Why are they here?')).toBeTruthy()
  expect(screen.getByText('Amy Adams')).toBeTruthy()
  expect(
    screen.getByText(
      '4K · 2160p HEVC Dolby Vision · English TRUEHD 7.1 · 1 subtitle · 54.2 GB'
    )
  ).toBeTruthy()

  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Mark watched' }))
  expect(browse.watchedCalls).toEqual([{ itemId: 'arrival', watched: true }])
})

it('walks from a show to its episodes, with breadcrumbs back', async () => {
  const user = userEvent.setup()
  renderSignedIn('/item/severance')
  await screen.findByRole('heading', { name: 'Seasons' })
  await user.click(await screen.findByText('Season 1'))
  await screen.findByRole('heading', { name: 'Episodes' })
  await screen.findByText('Half Loop')
  // List items keep their parts apart with spaces, so they read as words.
  const episodes = screen
    .getAllByRole('listitem')
    .map((li) => li.textContent!.replace(/\s+/g, ' ').trim())
  expect(episodes).toEqual(['1 Good News About Hell ✓', '2 Half Loop'])

  await user.click(screen.getByText('Half Loop'))
  await screen.findByRole('heading', { name: 'Half Loop', level: 1 })
  const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
  expect(
    within(crumbs)
      .getAllByRole('link')
      .map((a) => a.textContent)
  ).toEqual(['Severance', 'Season 1'])
})

it('searches from the header', async () => {
  const user = userEvent.setup()
  renderSignedIn('/')
  await user.type(
    await screen.findByRole('searchbox', { name: 'Search' }),
    'zod{Enter}'
  )
  await screen.findByRole('heading', { name: 'Results for “zod”' })
  expect(screen.getByText('Zodiac')).toBeTruthy()
  expect(screen.queryByText('Severance')).toBeNull()
})

it('says so when an item is gone', async () => {
  renderSignedIn('/item/nope')
  expect(
    await screen.findByText(
      'This item doesn’t exist, or isn’t shared with you.'
    )
  ).toBeTruthy()
})
