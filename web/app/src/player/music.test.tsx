import { create } from '@bufbuild/protobuf'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import {
  PlaybackMethod,
  PlaybackPlanSchema
} from '../gen/weir/api/v1alpha/playback_pb'
import { FakeBrowse } from '../test/fakeBrowse'
import { renderSignedIn } from '../test/render'

function music() {
  const browse = new FakeBrowse()
  browse.plan = create(PlaybackPlanSchema, {
    method: PlaybackMethod.DIRECT_PLAY,
    url: '/media/files/f?sig=x',
    sessionId: 'a1'
  })
  return browse
}

const nowPlaying = () => screen.findByRole('region', { name: 'Now playing' })
const audio = () => document.querySelector('audio')!

it('plays an album through, track after track, then goes away', async () => {
  const user = userEvent.setup()
  const { browse } = renderSignedIn('/item/mhtrtc', music())
  await user.click(await screen.findByRole('button', { name: 'Play album' }))

  const bar = await nowPlaying()
  expect(within(bar).getByRole('link').textContent).toBe('Wildlife Analysis')
  expect(within(bar).getByText('1 of 3')).toBeTruthy()
  await vi.waitFor(() =>
    expect(audio().getAttribute('src')).toBe('/media/files/f?sig=x')
  )
  expect(browse.starts.map((s) => s.itemId)).toEqual(['t1'])
  // The album's track list marks what's playing.
  expect(
    screen
      .getByText('Wildlife Analysis', { selector: 'span' })
      .closest('li')!
      .getAttribute('aria-current')
  ).toBe('true')

  fireEvent.ended(audio())
  await within(bar).findByText('2 of 3')
  await vi.waitFor(() =>
    expect(browse.starts.map((s) => s.itemId)).toEqual(['t1', 't2'])
  )
  await vi.waitFor(() => expect(browse.stops).toHaveLength(1))
  expect(browse.stops[0]!.itemId).toBe('t1')

  // From the last track, the end of the queue.
  await user.click(
    screen.getByRole('button', { name: 'Play The Color of the Fire' })
  )
  await within(await nowPlaying()).findByText('3 of 3')
  expect(
    within(await nowPlaying())
      .getByRole('button', { name: 'Next track' })
      .hasAttribute('disabled')
  ).toBe(true)
  fireEvent.ended(audio())
  await vi.waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Now playing' })).toBeNull()
  )
  await vi.waitFor(() =>
    expect(browse.stops.map((s) => s.itemId)).toEqual(['t1', 't2', 't3'])
  )
})

it('keeps playing while browsing, and jumps within the queue', async () => {
  const user = userEvent.setup()
  const { browse } = renderSignedIn('/item/mhtrtc', music())
  await user.click(await screen.findByRole('button', { name: 'Play album' }))
  await nowPlaying()

  await user.click(screen.getByRole('link', { name: 'Films' }))
  await screen.findByRole('heading', { name: 'Films' })
  const bar = await nowPlaying()
  expect(within(bar).getByText('1 of 3')).toBeTruthy()
  expect(browse.starts).toHaveLength(1)
  expect(browse.stops).toHaveLength(0)

  await user.click(within(bar).getByRole('button', { name: 'Queue' }))
  const queue = within(bar).getByRole('list', { name: 'Queue' })
  await user.click(
    within(queue).getByRole('button', { name: 'The Color of the Fire' })
  )
  await within(bar).findByText('3 of 3')
  await vi.waitFor(() =>
    expect(browse.starts.map((s) => s.itemId)).toEqual(['t1', 't3'])
  )
  await user.click(within(bar).getByRole('button', { name: 'Previous track' }))
  await within(bar).findByText('2 of 3')
})

it('stops the music when a film starts', async () => {
  const user = userEvent.setup()
  const { browse } = renderSignedIn('/item/mhtrtc', music())
  await user.click(await screen.findByRole('button', { name: 'Play album' }))
  await nowPlaying()

  await user.click(screen.getByRole('link', { name: 'Films' }))
  await user.click(await screen.findByRole('link', { name: /Arrival/ }))
  await user.click(
    await screen.findByRole('link', { name: 'Resume from 40:00' })
  )
  await screen.findByRole('link', { name: '‹ Arrival' })
  await vi.waitFor(() =>
    expect(browse.stops.map((s) => s.itemId)).toContain('t1')
  )

  // Back in the app, the queue is gone rather than starting over.
  await user.click(screen.getByRole('link', { name: '‹ Arrival' }))
  await screen.findByRole('heading', { name: 'Arrival' })
  expect(screen.queryByRole('region', { name: 'Now playing' })).toBeNull()
})

it('plays a single track from its page', async () => {
  const user = userEvent.setup()
  const { browse } = renderSignedIn('/item/t2', music())
  await user.click(await screen.findByRole('button', { name: 'Play' }))
  const bar = await nowPlaying()
  expect(within(bar).getByText('1 of 1')).toBeTruthy()
  await vi.waitFor(() =>
    expect(browse.starts.map((s) => s.itemId)).toEqual(['t2'])
  )
})
