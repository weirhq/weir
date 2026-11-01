import { IconButton, Slider } from '@weirhq/m3e'
import { useEffect, useState, type RefObject } from 'react'
import { useMediaQuery } from '../media'
import styles from './parts.module.css'

// What both players share: the media element's state, the scrubber and the
// volume, so a film and a song are controlled the same way.

const volumeKey = 'weir.volume'

/** "1:02:03", or "2:03" under an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Sets the volume last chosen, if there is one. */
function restoreVolume(el: HTMLMediaElement) {
  try {
    const saved = Number(localStorage.getItem(volumeKey))
    if (saved > 0 && saved <= 1) el.volume = saved
  } catch {
    // Remembering the volume is a convenience.
  }
}

/** Sets the volume, muted at nothing, and remembers it for next time. */
export function setVolume(el: HTMLMediaElement, v: number) {
  el.volume = v
  el.muted = v === 0
  try {
    if (v > 0) localStorage.setItem(volumeKey, String(v))
  } catch {
    // Remembering the volume is a convenience.
  }
}

/** Mutes, or unmutes. */
export function toggleMute(el: HTMLMediaElement) {
  el.muted = !el.muted
}

/** Plays, or pauses if it's playing. */
export function togglePlay(el: HTMLMediaElement) {
  if (el.paused || el.ended) void el.play().catch(() => undefined)
  else el.pause()
}

/** Seeks to a time, kept within the media. */
export function seek(el: HTMLMediaElement, t: number, duration: number) {
  el.currentTime = Math.min(Math.max(0, t), duration || t)
}

/**
 * What the media element is doing, kept in step with its events. The
 * element must be there when this mounts.
 */
export function useMedia(media: RefObject<HTMLMediaElement | null>) {
  const [state, setState] = useState({
    playing: false,
    waiting: true,
    time: 0,
    duration: 0,
    volume: 1,
    muted: false
  })
  useEffect(() => {
    const el = media.current
    if (!el) return
    restoreVolume(el)
    const read = () =>
      setState({
        playing: !el.paused && !el.ended,
        waiting: el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
        time: el.currentTime,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        volume: el.volume,
        muted: el.muted
      })
    const events = [
      'play',
      'pause',
      'ended',
      'waiting',
      'playing',
      'canplay',
      'loadedmetadata',
      'durationchange',
      'timeupdate',
      'seeking',
      'seeked',
      'volumechange'
    ]
    for (const e of events) el.addEventListener(e, read)
    return () => {
      for (const e of events) el.removeEventListener(e, read)
    }
  }, [media])
  return state
}

/**
 * The time played, a scrubber and the time left. It seeks once the handle
 * is let go, showing where it's held meanwhile.
 */
export function Scrubber({
  media,
  time,
  duration,
  onHold
}: {
  media: RefObject<HTMLMediaElement | null>
  time: number
  duration: number
  /** Whether the scrubber is held, as that changes. */
  onHold?: (held: boolean) => void
}) {
  const [scrub, setScrub] = useState<number>()
  const hold = (at: number | undefined) => {
    setScrub(at)
    onHold?.(at !== undefined)
  }
  const commit = () => {
    if (scrub !== undefined && media.current)
      seek(media.current, scrub, duration)
    hold(undefined)
  }
  const at = scrub ?? time
  return (
    <div className={styles.scrubber}>
      <span className={styles.time}>{clock(at)}</span>
      {/* The slider takes the pointer itself; its release bubbles up here,
          where the seek happens once the handle is let go. */}
      <div
        className={styles.seek}
        onPointerUp={commit}
        onPointerCancel={commit}
      >
        <Slider
          className={styles.bar}
          aria-label="Seek"
          aria-valuetext={`${clock(at)} of ${clock(duration)}`}
          min={0}
          max={Math.max(duration, 1)}
          value={Math.min(at, Math.max(duration, 1))}
          valueLabel={clock}
          onValueChange={hold}
          onKeyUp={commit}
        />
      </div>
      <span className={styles.time}>-{clock(duration - at)}</span>
    </div>
  )
}

/**
 * The volume: an icon whose slider unfolds beside it once it's clicked, and
 * which then mutes and unmutes. Whoever shows it says when it folds again.
 * Narrow windows have no slider; phones have volume buttons.
 */
export function Volume({
  media,
  volume,
  muted,
  open,
  onOpen
}: {
  media: RefObject<HTMLMediaElement | null>
  volume: number
  muted: boolean
  open: boolean
  onOpen: () => void
}) {
  const slider = useMediaQuery('(min-width: 601px)')
  const folded = slider && !open
  const level = muted ? 0 : volume
  return (
    <div className={styles.volume} data-open={(slider && open) || undefined}>
      {/* The one button, so it keeps focus as it unfolds the slider. */}
      <IconButton
        icon={level === 0 ? 'volume_off' : 'volume_up'}
        label={folded ? 'Volume' : muted ? 'Unmute' : 'Mute'}
        aria-expanded={folded ? false : undefined}
        onClick={() => {
          const el = media.current
          if (folded) onOpen()
          else if (el) toggleMute(el)
        }}
      />
      {slider && (
        <Slider
          className={`${styles.bar} ${styles.volumeSlider}`}
          aria-label="Volume"
          min={0}
          max={1}
          value={level}
          onValueChange={(v) => media.current && setVolume(media.current, v)}
        />
      )}
    </div>
  )
}
