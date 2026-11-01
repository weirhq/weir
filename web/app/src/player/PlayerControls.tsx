import { IconButton, LoadingIndicator, Slider } from '@weirhq/m3e'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import styles from './PlayerControls.module.css'

const volumeKey = 'weir.volume'
// How long controls stay up after the last movement while playing.
const idleMs = 3000

// Safari's names for what other browsers do with the standard APIs.
type WebKitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitShowPlaybackTargetPicker?: () => void
  webkitSetPresentationMode?: (mode: string) => void
}
type WebKitElement = HTMLElement & { webkitRequestFullscreen?: () => void }
type WebKitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}

/** "1:02:03", or "2:03" under an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Sets the volume last chosen, if there is one. */
function restoreVolume(el: HTMLVideoElement) {
  try {
    const saved = Number(localStorage.getItem(volumeKey))
    if (saved > 0 && saved <= 1) el.volume = saved
  } catch {
    // Remembering the volume is a convenience.
  }
}

/** Picture-in-picture: the standard API, or Safari's presentation modes. */
function canPictureInPicture(): boolean {
  return (
    document.pictureInPictureEnabled ||
    'webkitSetPresentationMode' in HTMLVideoElement.prototype
  )
}

/** What the video element is doing, kept in step with its events. */
function useMedia(media: RefObject<HTMLVideoElement | null>) {
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
 * Weir's own controls over a video, instead of each browser's: a scrubber,
 * play, skips, volume, AirPlay, picture-in-picture and fullscreen, with a
 * header at the top. They fade out while it plays and nothing moves, and
 * come back on movement, a tap or a key.
 */
export function PlayerControls({
  media,
  stage,
  runtime,
  header,
  children
}: {
  media: RefObject<HTMLVideoElement | null>
  /** What goes fullscreen: the video with these controls over it. */
  stage: RefObject<HTMLDivElement | null>
  /** The item's runtime in seconds, until the media knows its own. */
  runtime: number
  /** Shown along the top with the controls. */
  header: ReactNode
  /** Over the video, under the controls, such as messages and panels. */
  children?: ReactNode
}) {
  const m = useMedia(media)
  const duration = m.duration || runtime
  // Where the scrubber is held, while it is.
  const [scrub, setScrub] = useState<number>()
  const [active, setActive] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [airplay, setAirplay] = useState(false)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shown = active || !m.playing || scrub !== undefined

  // Movement brings the controls back; stillness while playing hides them.
  const wake = useCallback(() => {
    setActive(true)
    clearTimeout(idle.current)
    idle.current = setTimeout(() => setActive(false), idleMs)
  }, [])
  useEffect(() => () => clearTimeout(idle.current), [])

  useEffect(() => {
    const onChange = () => {
      const d = document as WebKitDocument
      setFullscreen(!!(d.fullscreenElement ?? d.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  // Safari says when there's an AirPlay device to send to.
  useEffect(() => {
    const el = media.current
    if (!el || !('WebKitPlaybackTargetAvailabilityEvent' in window)) return
    const onChange = (e: Event) =>
      setAirplay(
        (e as Event & { availability: string }).availability === 'available'
      )
    el.addEventListener('webkitplaybacktargetavailabilitychanged', onChange)
    return () =>
      el.removeEventListener(
        'webkitplaybacktargetavailabilitychanged',
        onChange
      )
  }, [media])

  const video = () => media.current as WebKitVideo | null
  const toggle = () => {
    const el = video()
    if (!el) return
    if (el.paused || el.ended) void el.play().catch(() => undefined)
    else el.pause()
  }
  const seekTo = (t: number) => {
    const el = video()
    if (el) el.currentTime = Math.min(Math.max(0, t), duration || t)
  }
  const setVolume = (v: number) => {
    const el = video()
    if (!el) return
    el.volume = v
    el.muted = v === 0
    try {
      if (v > 0) localStorage.setItem(volumeKey, String(v))
    } catch {
      // Remembering the volume is a convenience.
    }
  }
  const toggleFullscreen = () => {
    const d = document as WebKitDocument
    const el = stage.current as WebKitElement | null
    if (d.fullscreenElement ?? d.webkitFullscreenElement) {
      void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
    } else if (el?.requestFullscreen) {
      void el.requestFullscreen().catch(() => undefined)
    } else if (el?.webkitRequestFullscreen) {
      el.webkitRequestFullscreen()
    } else {
      // An iPhone can only put the video itself fullscreen, in its own player.
      video()?.webkitEnterFullscreen?.()
    }
  }
  const pip = () => {
    const el = video()
    if (!el) return
    if (document.pictureInPictureElement)
      void document.exitPictureInPicture().catch(() => undefined)
    else if (document.pictureInPictureEnabled)
      void el.requestPictureInPicture().catch(() => undefined)
    else el.webkitSetPresentationMode?.('picture-in-picture')
  }

  // Keys anywhere on the player, except where they mean something already.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, [role="menu"], [role="dialog"]')) return
      const onButton = !!t.closest('button, a')
      const el = media.current
      if (!el) return
      wake()
      switch (e.key) {
        case ' ':
        case 'k':
          if (onButton && e.key === ' ') return
          e.preventDefault()
          toggle()
          break
        case 'ArrowLeft':
        case 'j':
          e.preventDefault()
          seekTo(el.currentTime - 10)
          break
        case 'ArrowRight':
        case 'l':
          e.preventDefault()
          seekTo(el.currentTime + 10)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume(Math.min(1, el.volume + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume(Math.max(0, el.volume - 0.1))
          break
        case 'm':
          el.muted = !el.muted
          break
        case 'f':
          toggleFullscreen()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Seeks to where the scrubber was let go.
  const commit = () => {
    if (scrub !== undefined) seekTo(scrub)
    setScrub(undefined)
  }
  const time = scrub ?? m.time
  const volume = m.muted ? 0 : m.volume
  return (
    <div
      className={styles.overlay}
      data-shown={shown || undefined}
      onPointerMove={(e) => e.pointerType === 'mouse' && wake()}
      onPointerDown={wake}
    >
      {/* The video's own area: a click plays or pauses, a double click goes
          fullscreen; a tap only brings the controls back. */}
      <div
        className={styles.surface}
        onClick={(e) => {
          if ((e.nativeEvent as PointerEvent).pointerType !== 'touch') toggle()
        }}
        onDoubleClick={toggleFullscreen}
        aria-hidden="true"
      />
      {m.waiting && m.playing && (
        <LoadingIndicator className={styles.loading} aria-label="Loading" />
      )}
      <div className={styles.top}>{header}</div>
      {children}
      <div className={styles.bottom}>
        <div className={styles.scrubber}>
          <span className={styles.time}>{clock(time)}</span>
          {/* The slider takes the pointer itself; its release bubbles up
              here, where the seek happens once the handle is let go. */}
          <div
            className={styles.seek}
            onPointerUp={commit}
            onPointerCancel={commit}
          >
            <Slider
              aria-label="Seek"
              aria-valuetext={`${clock(time)} of ${clock(duration)}`}
              min={0}
              max={Math.max(duration, 1)}
              value={Math.min(time, Math.max(duration, 1))}
              valueLabel={clock}
              onValueChange={setScrub}
              onKeyUp={commit}
            />
          </div>
          <span className={styles.time}>-{clock(duration - time)}</span>
        </div>
        <div className={styles.buttons}>
          <IconButton
            icon={m.playing ? 'pause' : 'play_arrow'}
            label={m.playing ? 'Pause' : 'Play'}
            size="m"
            onClick={toggle}
          />
          <IconButton
            icon="replay_10"
            label="Back 10 seconds"
            onClick={() => seekTo((video()?.currentTime ?? 0) - 10)}
          />
          <IconButton
            icon="forward_30"
            label="Forward 30 seconds"
            onClick={() => seekTo((video()?.currentTime ?? 0) + 30)}
          />
          <div className={styles.volume}>
            <IconButton
              icon={volume === 0 ? 'volume_off' : 'volume_up'}
              label={m.muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                const el = video()
                if (el) el.muted = !el.muted
              }}
            />
            <Slider
              className={styles.volumeSlider}
              aria-label="Volume"
              min={0}
              max={1}
              value={volume}
              onValueChange={setVolume}
            />
          </div>
          <span className={styles.spacer} />
          {airplay && (
            <IconButton
              icon="airplay"
              label="AirPlay"
              onClick={() => video()?.webkitShowPlaybackTargetPicker?.()}
            />
          )}
          {canPictureInPicture() && (
            <IconButton
              icon="picture_in_picture_alt"
              label="Picture in picture"
              onClick={pip}
            />
          )}
          <IconButton
            icon={fullscreen ? 'fullscreen_exit' : 'fullscreen'}
            label={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={toggleFullscreen}
          />
        </div>
      </div>
    </div>
  )
}
