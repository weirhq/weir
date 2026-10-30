import { create } from '@bufbuild/protobuf'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import {
  PlaybackMethod,
  PlaybackPlanSchema
} from '../gen/weir/api/v1alpha/playback_pb'
import { FakeBrowse } from '../test/fakeBrowse'
import { renderSignedIn } from '../test/render'

it('lists playlists, and creates one', async () => {
  const user = userEvent.setup()
  const { browse } = renderSignedIn('/playlists')
  const rainy = await screen.findByRole('link', { name: /Rainy day/ })
  expect(rainy.textContent).toBe('Rainy day3 items')
  expect(screen.getByRole('link', { name: /Road trip/ }).textContent).toBe(
    'Road trip1 item · shared by Ana'
  )

  await user.type(screen.getByLabelText('New playlist'), 'Late night')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  await screen.findByRole('heading', { name: 'Late night' })
  expect(browse.playlists.at(-1)).toMatchObject({
    name: 'Late night',
    ownerId: 'u1',
    itemIds: []
  })
})

it('plays, edits, shares and deletes your own playlist', async () => {
  const user = userEvent.setup()
  const browse = new FakeBrowse()
  browse.plan = create(PlaybackPlanSchema, {
    method: PlaybackMethod.DIRECT_PLAY,
    url: '/media/files/f?sig=x',
    sessionId: 'a1'
  })
  renderSignedIn('/playlist/rainy', browse)
  await screen.findByRole('heading', { name: 'Rainy day' })
  const list = screen.getByRole('list')
  expect(
    within(list)
      .getAllByRole('link', { name: /^(?!Play)/ })
      .map((a) => a.textContent)
  ).toEqual(['An Eagle in Your Mind', 'Arrival', 'The Color of the Fire'])

  // Only the tracks go to the mini-player; the film plays full screen.
  await user.click(screen.getByRole('button', { name: 'Play all tracks' }))
  const bar = await screen.findByRole('region', { name: 'Now playing' })
  expect(within(bar).getByText('1 of 2')).toBeTruthy()
  await vi.waitFor(() =>
    expect(browse.starts.map((s) => s.itemId)).toEqual(['t2'])
  )
  expect(
    screen.getByRole('link', { name: 'Play Arrival' }).getAttribute('href')
  ).toBe('/play/arrival')

  await user.click(screen.getByRole('button', { name: 'Remove Arrival' }))
  await vi.waitFor(() =>
    expect(browse.playlists[0]!.itemIds).toEqual(['t2', 't3'])
  )
  await screen.findByText('2 items')

  await user.click(screen.getByRole('button', { name: 'Rename' }))
  const name = screen.getByLabelText('Name')
  await user.clear(name)
  await user.type(name, 'Grey day')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('heading', { name: 'Grey day' })

  await user.click(
    screen.getByRole('checkbox', { name: 'Shared with everyone' })
  )
  await vi.waitFor(() => expect(browse.playlists[0]!.shared).toBe(true))

  await user.click(screen.getByRole('button', { name: 'Delete playlist' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await screen.findByRole('heading', { name: 'Playlists' })
  expect(browse.playlists.map((p) => p.id)).toEqual(['mix'])
})

it('shows someone else’s shared playlist without the owner’s controls', async () => {
  renderSignedIn('/playlist/mix')
  await screen.findByRole('heading', { name: 'Road trip' })
  expect(screen.getByText('1 item · shared by Ana')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Play all' })).toBeTruthy()
  for (const name of ['Rename', 'Delete playlist', 'Remove Wildlife Analysis'])
    expect(screen.queryByRole('button', { name })).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
})

it('adds an item to a playlist from its page, or to a new one', async () => {
  const user = userEvent.setup()
  const { browse } = renderSignedIn('/item/zodiac')
  await user.click(
    await screen.findByRole('button', { name: 'Add to playlist' })
  )
  const panel = screen.getByRole('group', { name: 'Add to playlist' })
  // Only your own playlists take additions.
  expect(
    (await within(panel).findAllByRole('button', { name: /day|trip/ })).map(
      (b) => b.textContent
    )
  ).toEqual(['Rainy day'])
  await user.click(within(panel).getByRole('button', { name: 'Rainy day' }))
  expect((await screen.findByRole('status')).textContent).toBe(
    'Added to Rainy day'
  )
  expect(browse.playlists[0]!.itemIds).toEqual([
    't2',
    'arrival',
    't3',
    'zodiac'
  ])

  await user.click(screen.getByRole('button', { name: 'Add to playlist' }))
  await user.type(screen.getByLabelText('New playlist'), 'Fincher')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect((await screen.findByRole('status')).textContent).toBe(
    'Added to Fincher'
  )
  expect(browse.playlists.at(-1)).toMatchObject({
    name: 'Fincher',
    itemIds: ['zodiac']
  })
})
