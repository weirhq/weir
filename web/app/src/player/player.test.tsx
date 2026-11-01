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

it('starts from the beginning when asked, whatever the resume point', async () => {
  const browse = browseWith({
    method: PlaybackMethod.REMUX,
    url: '/media/sessions/s1/index.m3u8?sig=x',
    sessionId: 's1'
  })
  renderSignedIn('/play/arrival?from=start', browse)
  await vi.waitFor(() => expect(hls.instances).toHaveLength(1))
  expect(hls.instances[0]!.config.startPosition).toBe(-1)
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

describe('the player’s own controls', () => {
  // jsdom's media elements don't play; this one keeps the state the
  // controls read and write, and says when it changes.
  function fakeVideo() {
    const el = document.querySelector('video')!
    let time = 0
    let paused = true
    Object.defineProperties(el, {
      currentTime: {
        get: () => time,
        set: (t: number) => {
          time = t
          el.dispatchEvent(new Event('timeupdate'))
        },
        configurable: true
      },
      duration: { get: () => 600, configurable: true },
      paused: { get: () => paused, configurable: true },
      readyState: { get: () => 4, configurable: true }
    })
    el.play = () => {
      paused = false
      el.dispatchEvent(new Event('play'))
      return Promise.resolve()
    }
    el.pause = () => {
      paused = true
      el.dispatchEvent(new Event('pause'))
    }
    act(() => {
      el.dispatchEvent(new Event('durationchange'))
    })
    return el
  }

  async function open() {
    const browse = browseWith({
      method: PlaybackMethod.DIRECT_PLAY,
      url: '/media/files/f1?sig=x'
    })
    renderSignedIn('/play/zodiac', browse)
    await screen.findByRole('link', { name: '‹ Zodiac' })
    // No browser controls: Weir draws its own.
    expect(document.querySelector('video')!.hasAttribute('controls')).toBe(
      false
    )
    return fakeVideo()
  }

  it('plays, pauses and skips by button and key', async () => {
    const user = userEvent.setup()
    const video = await open()
    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(video.paused).toBe(false)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    await user.keyboard('k')
    expect(video.paused).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Forward 30 seconds' }))
    expect(video.currentTime).toBe(30)
    await user.click(screen.getByRole('button', { name: 'Back 10 seconds' }))
    expect(video.currentTime).toBe(20)
    // The arrows move ten seconds, not past the start.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(30)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(video.currentTime).toBe(0)
  })

  it('measures the scrubber by the runtime while the stream is still growing', async () => {
    const browse = browseWith({
      method: PlaybackMethod.REMUX,
      url: '/media/sessions/s1/index.m3u8?sig=x',
      sessionId: 's1'
    })
    renderSignedIn('/play/arrival', browse)
    await screen.findByRole('link', { name: '‹ Arrival' })
    // The stream has ten minutes so far; Arrival runs 1 h 56 min.
    fakeVideo()
    await vi.waitFor(() =>
      expect(
        screen.getByRole('slider', { name: 'Seek' }).getAttribute('max')
      ).toBe(String(116 * 60))
    )
  })

  it('seeks with the scrubber once it’s let go, showing the time', async () => {
    const video = await open()
    const seek = screen.getByRole('slider', { name: 'Seek' })
    expect(seek.getAttribute('aria-valuetext')).toBe('0:00 of 10:00')
    fireEvent.change(seek, { target: { value: '125' } })
    // Not yet: it's still held.
    expect(video.currentTime).toBe(0)
    expect(screen.getByText('-7:55')).toBeTruthy()
    // The release bubbles up from the slider to where it's committed.
    fireEvent.pointerUp(seek)
    expect(video.currentTime).toBe(125)
  })

  it('switches subtitles from the menu, carrying on from where it was', async () => {
    const user = userEvent.setup()
    const browse = browseWith({
      method: PlaybackMethod.DIRECT_PLAY,
      url: '/media/files/a1?sig=x',
      versionId: 'arrival-v1',
      streams: [
        { index: 0, action: StreamAction.DIRECT },
        { index: 1, action: StreamAction.DIRECT }
      ]
    })
    renderSignedIn('/play/arrival?from=start', browse)
    await screen.findByRole('link', { name: '‹ Arrival' })
    const video = fakeVideo()
    video.currentTime = 754

    await user.click(
      screen.getByRole('button', { name: 'Audio and subtitles' })
    )
    const off = await screen.findByRole('menuitem', { name: 'Off' })
    // No subtitle playing, so Off is ticked.
    expect(off.textContent).toContain('check')
    // The next start serves it beside the video.
    browse.plan = create(PlaybackPlanSchema, {
      method: PlaybackMethod.DIRECT_PLAY,
      url: '/media/files/a1?sig=x',
      versionId: 'arrival-v1',
      streams: [
        { index: 0, action: StreamAction.DIRECT },
        { index: 1, action: StreamAction.DIRECT },
        { index: 2, action: StreamAction.SIDECAR }
      ],
      subtitleUrl: '/media/subtitles/f/2.vtt?sig=x'
    })
    await user.click(screen.getByRole('menuitem', { name: 'English' }))
    await vi.waitFor(() => expect(browse.starts).toHaveLength(2))
    expect(browse.starts[1]!.subtitleStreamIndex).toBe(2)
    await vi.waitFor(() =>
      expect(document.querySelector('track')?.getAttribute('src')).toBe(
        '/media/subtitles/f/2.vtt?sig=x'
      )
    )
    expect(document.querySelector('track')!.getAttribute('label')).toBe(
      'English'
    )
    // Off goes back without them.
    await user.click(
      screen.getByRole('button', { name: 'Audio and subtitles' })
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Off' }))
    await vi.waitFor(() => expect(browse.starts).toHaveLength(3))
    expect(browse.starts[2]!.subtitleStreamIndex).toBe(-1)
  })

  it('goes full screen with the controls, and remembers the volume', async () => {
    const user = userEvent.setup()
    const requestFullscreen = vi.fn(() => Promise.resolve())
    HTMLElement.prototype.requestFullscreen = requestFullscreen
    const video = await open()
    await user.click(screen.getByRole('button', { name: 'Full screen' }))
    // The whole player, so its controls come too, not the bare video.
    expect(requestFullscreen.mock.contexts[0]).toBe(video.parentElement)

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), {
      target: { value: '0.4' }
    })
    expect(video.volume).toBeCloseTo(0.4)
    expect(localStorage.getItem('weir.volume')).toBe('0.4')
  })
})
