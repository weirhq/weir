import { detectCapabilities } from './capabilities'

// What each browser answers canPlayType with, roughly.
const answers = (supported: string[]) => (type: string) =>
  supported.some((s) => type.includes(s)) ? 'probably' : ''
const ua = {
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  firefox:
    'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0'
}

it('drops the HEVC Chrome on Linux claims but cannot decode', () => {
  const caps = detectCapabilities({
    userAgent: ua.chromeLinux,
    canPlayType: answers([
      'avc1',
      'hvc1',
      'av01',
      'vp09',
      'video/webm',
      'mp4a',
      'opus',
      'flac'
    ])
  })
  expect(caps.videoCodecs.map((c) => c.codec)).toEqual(['h264', 'av1', 'vp9'])
  expect(caps.containers).toEqual(['mp4', 'webm', 'flac'])
  expect(caps.hdrFormats).toEqual([])
})

it('keeps Safari’s HEVC Main 10 and Dolby Digital Plus', () => {
  const caps = detectCapabilities({
    userAgent: ua.safari,
    canPlayType: answers([
      'avc1',
      'hvc1.2.4',
      'mp4a',
      'ec-3',
      'ac-3',
      'audio/mpeg'
    ])
  })
  expect(caps.videoCodecs).toEqual([
    expect.objectContaining({ codec: 'h264', maxBitDepth: 8 }),
    expect.objectContaining({ codec: 'hevc', maxBitDepth: 10 })
  ])
  expect(caps.audioCodecs.map((c) => [c.codec, c.maxChannels])).toEqual([
    ['aac', 2],
    ['mp3', 2],
    ['eac3', 6],
    ['ac3', 6]
  ])
})

it('declares plain URLs and HLS, and only text subtitles', () => {
  const caps = detectCapabilities({
    userAgent: ua.firefox,
    canPlayType: answers(['avc1', 'mp4a'])
  })
  expect(caps.plainUrl && caps.hls).toBe(true)
  expect(caps.subtitleCodecs).toEqual(['webvtt'])
})
