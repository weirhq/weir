import { create } from '@bufbuild/protobuf'
import {
  ClientCapabilitiesSchema,
  type ClientCapabilities
} from '../gen/weir/api/v1alpha/playback_pb'

/** What the detector needs from the browser, so tests can stand in for it. */
export type Browser = {
  canPlayType: (type: string) => string
  userAgent: string
}

export function currentBrowser(): Browser {
  const video = document.createElement('video')
  return {
    canPlayType: (t) => video.canPlayType(t),
    userAgent: navigator.userAgent
  }
}

/**
 * Declares what this browser plays, per spec §8: declared, not sniffed
 * mid-playback. The web client shows no HDR and draws no image subtitles;
 * it lets the server tonemap, transcode and burn in.
 */
export function detectCapabilities(browser: Browser): ClientCapabilities {
  const can = (type: string) => browser.canPlayType(type) !== ''
  // Browsers that claim more than they can play.
  const chromeOnLinux =
    /Linux/.test(browser.userAgent) &&
    /Chrome\//.test(browser.userAgent) &&
    !/Edg\//.test(browser.userAgent) &&
    !/Android/.test(browser.userAgent)

  const videoCodecs = []
  if (can('video/mp4; codecs="avc1.640029"'))
    videoCodecs.push({ codec: 'h264', maxBitDepth: 8 })
  // Chrome on Linux answers "probably" for HEVC but plays it only with a
  // hardware decoder it rarely has.
  if (!chromeOnLinux) {
    if (can('video/mp4; codecs="hvc1.2.4.L153.B0"'))
      videoCodecs.push({ codec: 'hevc', maxBitDepth: 10 })
    else if (can('video/mp4; codecs="hvc1.1.6.L120.90"'))
      videoCodecs.push({ codec: 'hevc', maxBitDepth: 8 })
  }
  if (can('video/mp4; codecs="av01.0.08M.10"'))
    videoCodecs.push({ codec: 'av1', maxBitDepth: 10 })
  else if (can('video/mp4; codecs="av01.0.08M.08"'))
    videoCodecs.push({ codec: 'av1', maxBitDepth: 8 })
  if (can('video/webm; codecs="vp09.02.40.10"'))
    videoCodecs.push({ codec: 'vp9', maxBitDepth: 10 })
  else if (can('video/webm; codecs="vp9"'))
    videoCodecs.push({ codec: 'vp9', maxBitDepth: 8 })

  const audioCodecs = []
  if (can('audio/mp4; codecs="mp4a.40.2"'))
    audioCodecs.push({ codec: 'aac', maxChannels: 2 })
  if (can('audio/webm; codecs="opus"') || can('audio/mp4; codecs="opus"'))
    audioCodecs.push({ codec: 'opus', maxChannels: 2 })
  if (can('audio/flac') || can('audio/mp4; codecs="flac"'))
    audioCodecs.push({ codec: 'flac', maxChannels: 2 })
  if (can('audio/mpeg')) audioCodecs.push({ codec: 'mp3', maxChannels: 2 })
  if (can('audio/mp4; codecs="ec-3"'))
    audioCodecs.push({ codec: 'eac3', maxChannels: 6 })
  if (can('audio/mp4; codecs="ac-3"'))
    audioCodecs.push({ codec: 'ac3', maxChannels: 6 })

  const containers = ['mp4']
  if (can('video/webm')) containers.push('webm')
  if (can('audio/flac')) containers.push('flac')
  if (can('audio/mpeg')) containers.push('mp3')

  return create(ClientCapabilitiesSchema, {
    containers,
    videoCodecs,
    audioCodecs,
    subtitleCodecs: ['webvtt'],
    plainUrl: true,
    hls: true
  })
}
