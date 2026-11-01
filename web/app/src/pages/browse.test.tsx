import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ItemSort } from '../gen/weir/api/v1alpha/browse_pb'
import { renderSignedIn } from '../test/render'

it('shows continue watching, recently added and the libraries', async () => {
  renderSignedIn('/')
  const resume = await screen.findByRole('region', {
    name: 'Continue watching'
  })
  expect(within(resume).getByText('Arrival')).toBeTruthy()
  // 40 minutes into 1 h 56 min.
  expect(within(resume).getByLabelText('34% watched')).toBeTruthy()
  // Recently added comes a row per library, albums with square covers.
  const titles = async (library: string) =>
    within(
      await screen.findByRole('region', {
        name: `Recently added in ${library}`
      })
    )
      .getAllByRole('link')
      // The cards, not the title's link to all of them.
      .filter((a) => !a.closest('h2'))
      .map((a) => a.textContent)
  expect(await titles('Films')).toEqual([
    expect.stringContaining('Arrival'),
    expect.stringContaining('Zodiac')
  ])
  expect(await titles('TV')).toEqual([expect.stringContaining('Severance')])
  expect(
    within(screen.getByRole('region', { name: 'Recently added in Films' }))
      .getByRole('heading')
      .querySelector('a')!
      .getAttribute('href')
  ).toBe('/library/films?sort=added')
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
  // The wordmark leads home; admins get Settings last.
  expect(within(nav).getAllByRole('link').map(label)).toEqual([
    'Weir',
    'Home',
    'Films',
    'TV',
    'Music',
    'Playlists',
    'Settings'
  ])
})

it('gives each library rows for new, released, unwatched and its genres', async () => {
  renderSignedIn('/')
  const link = async (name: string) =>
    within(await screen.findByRole('region', { name }))
      .getByRole('heading')
      .querySelector('a')!
      .getAttribute('href')
  expect(await link('Recently released in Films')).toBe(
    '/library/films?sort=released'
  )
  expect(await link('Unwatched in Films')).toBe(
    '/library/films?sort=added&unwatched=true'
  )
  expect(await link('Drama in Films')).toBe(
    '/library/films?sort=released&genre=Drama'
  )
  // Music has nothing to watch.
  await screen.findByRole('region', { name: 'Recently added in Music' })
  expect(
    screen.queryByRole('region', { name: 'Unwatched in Music' })
  ).toBeNull()
})

it('filters a library by what the address says, and changes it', async () => {
  const user = userEvent.setup()
  const { browse } = renderSignedIn('/library/films?genre=Drama')
  await screen.findByRole('heading', { name: 'Films' })
  await vi.waitFor(() => expect(browse.listCalls.at(-1)?.genre).toBe('Drama'))
  expect(screen.getByText('Arrival')).toBeTruthy()
  expect(screen.queryByText('Zodiac')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Unwatched' }))
  await vi.waitFor(() =>
    expect(browse.listCalls.at(-1)).toMatchObject({
      genre: 'Drama',
      unwatched: true
    })
  )
})

it('lists a library as a grid, sorted as the address says', async () => {
  const { browse } = renderSignedIn('/library/films?sort=added')
  await screen.findByRole('heading', { name: 'Films' })
  await vi.waitFor(() =>
    expect(browse.listCalls.at(-1)?.sort).toBe(ItemSort.ADDED)
  )
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
  // Without a photo, a cast member shows their initials; one we know leads
  // to their page.
  const amy = screen.getByRole('link', { name: /Amy Adams/ })
  expect(amy.textContent).toContain('AA')
  expect(amy.getAttribute('href')).toBe('/person/9273')
  expect(screen.queryByRole('link', { name: /Jeremy Renner/ })).toBeNull()
  expect(screen.getByText('Jeremy Renner')).toBeTruthy()
  // Part-way through, it offers both resuming and starting over.
  expect(screen.getByRole('link', { name: 'Resume from 40:00' })).toBeTruthy()
  expect(
    screen
      .getByRole('link', { name: 'Play from beginning' })
      .getAttribute('href')
  ).toBe('/play/arrival?from=start')
  expect(
    screen.getByText(
      '4K · 2160p HEVC Dolby Vision · English Dolby TrueHD 7.1 · 1 subtitle · 54.2 GB'
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

it('shows a person and what they’re in', async () => {
  renderSignedIn('/person/9273')
  await screen.findByRole('heading', { name: 'Amy Adams', level: 1 })
  expect(screen.getByText('In 1 title you have')).toBeTruthy()
  expect(screen.getByRole('link', { name: /Arrival/ })).toBeTruthy()
  expect(screen.getByText('as Louise Banks')).toBeTruthy()
})

it('says so when a person isn’t known', async () => {
  renderSignedIn('/person/1')
  expect((await screen.findByRole('alert')).textContent).toBe(
    'This person isn’t in anything you have.'
  )
})

it('suggests matches under the search bar as you type', async () => {
  const user = userEvent.setup()
  renderSignedIn('/')
  const input = await screen.findByRole('searchbox', { name: 'Search' })
  await user.type(input, 'zod')
  await vi.waitFor(() =>
    expect(input.getAttribute('aria-expanded')).toBe('true')
  )
  const results = document.getElementById(input.getAttribute('aria-controls')!)!
  const match = within(results).getByRole('link', { name: /Zodiac/ })
  expect(match.textContent).toContain('Film · 2007')
  expect(input.getAttribute('aria-expanded')).toBe('true')
  await user.click(match)
  await screen.findByRole('heading', { name: 'Zodiac', level: 1 })
  expect(input.getAttribute('aria-expanded')).toBe('false')
  expect((input as HTMLInputElement).value).toBe('')
})

it('says so when an item is gone', async () => {
  renderSignedIn('/item/nope')
  expect(
    await screen.findByText(
      'This item doesn’t exist, or isn’t shared with you.'
    )
  ).toBeTruthy()
})

it('names an album’s artist under its title, not in breadcrumbs', async () => {
  renderSignedIn('/item/mhtrtc')
  const title = await screen.findByRole('heading', {
    name: 'Music Has the Right to Children',
    level: 1
  })
  const artist = screen.getByRole('link', { name: 'Boards of Canada' })
  expect(title.nextElementSibling).toBe(artist)
  expect(artist.getAttribute('href')).toBe('/item/boc')
  expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
})
