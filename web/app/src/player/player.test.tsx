import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import {
  PlaybackMethod,
  PlaybackPlanSchema,
  PlaybackReason,
  PlaybackWarning,
  StreamAction
} from '../gen/weir/api/v1alpha/playback_pb'
import { FakeBrowse } from '../test/fakeBrowse'
import { renderSignedIn } from '../test/render'

const hls = vi.hoisted(() => ({
  instances: [] as { config: { startPosition: number }; source: string }[]
}))
vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = () => true
    static Events = { ERROR: 'hlsError' }
    config: { startPosition: number }
    source = ''
    constructor(config: { startPosition: number }) {
      this.config = config
      hls.instances.push(this)
    }
    on() {}
    loadSource(url: string) {
      this.source = url
    }
    attachMedia() {}
    destroy() {}
  }
  return { default: FakeHls }
})

beforeEach(() => {
  hls.instances.length = 0
  window.HTMLMediaElement.prototype.canPlayType = (t: string) =>
    /avc1|mp4a/.test(t) ? 'probably' : ''
})

function browseWith(
  plan: Parameters<typeof create<typeof PlaybackPlanSchema>>[1]
) {
  const browse = new FakeBrowse()
  browse.plan = create(PlaybackPlanSchema, plan)
  return browse
}

it('direct-plays from the file URL, declaring what the browser plays', async () => {
  const browse = browseWith({
    method: PlaybackMethod.DIRECT_PLAY,
    url: '/media/files/f1?sig=x',
    versionId: 'zodiac-v1'
  })
  renderSignedIn('/play/zodiac', browse)
  await screen.findByRole('link', { name: '‹ Zodiac' })
  await vi.waitFor(() =>
    expect(document.querySelector('video')!.getAttribute('src')).toBe(
      '/media/files/f1?sig=x'
    )
  )
  const caps = browse.starts[0]!.capabilities!
  expect(caps.videoCodecs.map((c) => c.codec)).toEqual(['h264'])
  expect(hls.instances).toHaveLength(0)
})

it('plays HLS through hls.js from the resume point, and explains why', async () => {
  const browse = browseWith({
    method: PlaybackMethod.VIDEO_TRANSCODE,
    url: '/media/sessions/s1/index.m3u8?sig=x',
    sessionId: 's1',
    output: {
      container: 'mp4',
      videoCodec: 'h264',
      width: 1920,
      height: 1080,
      audioCodec: 'aac',
      audioChannels: 2
    },
    streams: [
      {
        index: 0,
        action: StreamAction.TRANSCODE,
        reasons: [PlaybackReason.VIDEO_CODEC_UNSUPPORTED]
      },
      {
        index: 1,
        action: StreamAction.TRANSCODE,
        reasons: [PlaybackReason.AUDIO_CODEC_UNSUPPORTED]
      }
    ],
    warnings: [PlaybackWarning.SOFTWARE_TRANSCODE]
  })
  renderSignedIn('/play/arrival', browse)
  // Arrival was left at 40 minutes.
  await vi.waitFor(() => expect(hls.instances).toHaveLength(1))
  expect(hls.instances[0]!.source).toBe('/media/sessions/s1/index.m3u8?sig=x')
  expect(hls.instances[0]!.config.startPosition).toBe(2400)

  await userEvent.setup().click(screen.getByRole('button', { name: 'Info' }))
  const panel = screen.getByRole('complementary', { name: 'Playback info' })
  expect(panel.textContent).toContain('Converting the video')
  expect(panel.textContent).toContain('mp4 · H264 1920×1080 · AAC stereo')
  expect(panel.textContent).toContain(
    'Stream 0: converted because this browser can’t decode the video codec'
  )
  expect(panel.textContent).toContain(
    'The server’s processor is converting this'
  )
})

it('sends heartbeats while playing and stops on the way out', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const browse = browseWith({
      method: PlaybackMethod.REMUX,
      url: '/media/sessions/s2/index.m3u8?sig=x',
      sessionId: 's2'
    })
    renderSignedIn('/play/zodiac', browse)
    await vi.waitFor(() => expect(hls.instances).toHaveLength(1))
    // Before anything plays, heartbeats carry no position.
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    await vi.waitFor(() => expect(browse.heartbeats).toHaveLength(1))
    expect(browse.heartbeats[0]).toMatchObject({
      sessionId: 's2',
      itemId: 'zodiac'
    })
    expect(browse.heartbeats[0]!.position).toBeUndefined()

    const video = document.querySelector('video')!
    Object.defineProperty(video, 'currentTime', {
      value: 123.4,
      configurable: true
    })
    fireEvent.timeUpdate(video)
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    await vi.waitFor(() => expect(browse.heartbeats).toHaveLength(2))
    expect(Number(browse.heartbeats[1]!.position!.seconds)).toBe(123)

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('link', { name: '‹ Zodiac' }))
    await vi.waitFor(() => expect(browse.stops).toHaveLength(1))
    // The element has been reset by now; the last reported position stands.
    expect(browse.stops[0]).toMatchObject({ sessionId: 's2', itemId: 'zodiac' })
    expect(Number(browse.stops[0]!.position!.seconds)).toBe(123)
  } finally {
    vi.useRealTimers()
  }
})

it('says when the server is too busy', async () => {
  const browse = new FakeBrowse()
  browse.plan = new ConnectError(
    'the server is busy with other playback',
    Code.ResourceExhausted
  )
  renderSignedIn('/play/zodiac', browse)
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The server is busy with other playback. Try again when something else finishes.'
  )
})
