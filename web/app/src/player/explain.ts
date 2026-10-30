import {
  PlaybackMethod,
  PlaybackReason,
  PlaybackWarning,
  StreamAction,
  type PlaybackPlan
} from '../gen/weir/api/v1alpha/playback_pb'

export const methodNames: Record<PlaybackMethod, string> = {
  [PlaybackMethod.UNSPECIFIED]: 'Unknown',
  [PlaybackMethod.DIRECT_PLAY]: 'Direct play: the file as it is',
  [PlaybackMethod.REMUX]: 'Remux: the same streams in a new container',
  [PlaybackMethod.AUDIO_TRANSCODE]: 'Converting the audio; video as it is',
  [PlaybackMethod.VIDEO_TRANSCODE]: 'Converting the video'
}

export const actionNames: Record<StreamAction, string> = {
  [StreamAction.UNSPECIFIED]: '',
  [StreamAction.DIRECT]: 'as it is',
  [StreamAction.REMUX]: 'copied',
  [StreamAction.TRANSCODE]: 'converted',
  [StreamAction.BURN_IN]: 'drawn into the picture',
  [StreamAction.SIDECAR]: 'separate track'
}

export const reasonNames: Record<PlaybackReason, string> = {
  [PlaybackReason.UNSPECIFIED]: '',
  [PlaybackReason.CONTAINER_UNSUPPORTED]:
    'this browser can’t open the file’s container',
  [PlaybackReason.CLIENT_NEEDS_HLS]: 'this player needs HLS',
  [PlaybackReason.VIDEO_CODEC_UNSUPPORTED]:
    'this browser can’t decode the video codec',
  [PlaybackReason.VIDEO_PROFILE_UNSUPPORTED]:
    'this browser can’t decode the video profile',
  [PlaybackReason.VIDEO_LEVEL_UNSUPPORTED]:
    'the video level is too high for this browser',
  [PlaybackReason.VIDEO_BIT_DEPTH_UNSUPPORTED]:
    'this browser can’t decode 10-bit video in this codec',
  [PlaybackReason.HDR_FORMAT_UNSUPPORTED]: 'this screen can’t show HDR',
  [PlaybackReason.DOLBY_VISION_PROFILE_UNSUPPORTED]:
    'this screen can’t show this Dolby Vision profile',
  [PlaybackReason.RESOLUTION_ABOVE_LIMIT]:
    'the picture is larger than this player allows',
  [PlaybackReason.BITRATE_ABOVE_LIMIT]: 'the bitrate is above your limit',
  [PlaybackReason.AUDIO_CODEC_UNSUPPORTED]:
    'this browser can’t play the audio codec',
  [PlaybackReason.AUDIO_CHANNELS_ABOVE_LIMIT]:
    'more audio channels than this browser plays',
  [PlaybackReason.SUBTITLE_NEEDS_BURN_IN]:
    'this browser can’t draw image subtitles'
}

export const warningNames: Record<PlaybackWarning, string> = {
  [PlaybackWarning.UNSPECIFIED]: '',
  [PlaybackWarning.SOFTWARE_TRANSCODE]:
    'The server’s processor is converting this; a faster device or one with hardware encoding would help.',
  [PlaybackWarning.SOFTWARE_4K]: '4K conversion in software may not keep up.',
  [PlaybackWarning.TONEMAP_UNAVAILABLE]:
    'HDR is being shown as SDR without tonemapping, so colours will look washed out.'
}

/** Output in one line: "fMP4 · H.264 1920×1080 · AAC stereo". */
export function describeOutput(plan: PlaybackPlan): string {
  const o = plan.output
  if (!o) return ''
  const video = [
    o.videoCodec.toUpperCase(),
    o.width && o.height ? `${o.width}×${o.height}` : '',
    o.bitrate ? `${(Number(o.bitrate) / 1e6).toFixed(1)} Mb/s` : ''
  ]
    .filter(Boolean)
    .join(' ')
  const audio = [
    o.audioCodec.toUpperCase(),
    o.audioChannels
      ? o.audioChannels === 2
        ? 'stereo'
        : `${o.audioChannels} ch`
      : ''
  ]
    .filter(Boolean)
    .join(' ')
  return [o.container, video, audio].filter(Boolean).join(' · ')
}
