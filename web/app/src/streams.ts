// How to name a file's streams, as people know them.

// What people call ffmpeg's codecs; the rest are shown in capitals.
const codecNames: Record<string, string> = {
  h264: 'H.264',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital Plus',
  truehd: 'Dolby TrueHD',
  dts: 'DTS',
  opus: 'Opus',
  vorbis: 'Vorbis',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM'
}

export function codecName(codec: string): string {
  return codecNames[codec] ?? codec.toUpperCase()
}

/** "stereo", "5.1" and so on. */
export function channels(n: number): string {
  return n === 0
    ? ''
    : n === 1
      ? 'mono'
      : n === 2
        ? 'stereo'
        : n === 6
          ? '5.1'
          : n === 8
            ? '7.1'
            : `${n} ch`
}

/** A BCP 47 tag in the reader's language: "en" is "English". */
export function languageName(tag: string): string {
  if (!tag) return ''
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}
