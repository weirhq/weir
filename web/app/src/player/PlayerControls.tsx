import {
  IconButton,
  LoadingIndicator,
  Menu,
  MenuDivider,
  MenuItem
} from '@weirhq/m3e'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import {
  Scrubber,
  seek,
  setVolume,
  togglePlay,
  useMedia,
  Volume
} from './parts'
import styles from './PlayerControls.module.css'

// How long controls stay up after the last movement while playing.
const idleMs = 3000

// Safari's names for what other browsers do with the standard APIs.
type WebKitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitShowPlaybackTargetPicker?: () => void
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
}
type WebKitElement = HTMLElement & { webkitRequestFullscreen?: () => void }
type WebKitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}

/** A stream to choose in the audio and subtitles menu. */
export type Track = { index: number; label: string; chosen: boolean }

export type Tracks = {
  audio: Track[]
  subtitles: Track[]
  /** A stream's index, or -1 for no subtitles. */
  onAudio: (index: number) => void
  onSubtitle: (index: number) => void
}

/** Picture-in-picture: the standard API, or Safari's presentation modes. */
function canPictureInPicture(): boolean {
  return (
    document.pictureInPictureEnabled ||
    'webkitSetPresentationMode' in HTMLVideoElement.prototype
  )
}

/** Whether the video is out of the page, in iOS's own full screen or
    picture-in-picture, where only the browser can draw captions. */
function presentedElsewhere(el: WebKitVideo): boolean {
  return (
    document.pictureInPictureElement === el ||
    (el.webkitPresentationMode ?? 'inline') !== 'inline'
  )
}

/**
 * The captions to show now, from the video's subtitle track. The track is
 * kept hidden so they can be drawn over the picture with the controls,
 * except while the video is presented elsewhere.
 */
function useCaptions(media: RefObject<HTMLVideoElement | null>) {
  const [cues, setCues] = useState<VTTCue[]>([])
  useEffect(() => {
    const el = media.current as WebKitVideo | null
    if (!el) return
    const tracks = el.textTracks
    const onCue = (e: Event) => {
      const t = e.target as TextTrack
      setCues(
        t.mode === 'hidden' ? ([...(t.activeCues ?? [])] as VTTCue[]) : []
      )
    }
    const sync = () => {
      const mode = presentedElsewhere(el) ? 'showing' : 'hidden'
      for (const t of tracks) {
        t.mode = mode
        t.removeEventListener('cuechange', onCue)
        t.addEventListener('cuechange', onCue)
      }
      if (mode === 'showing' || tracks.length === 0) setCues([])
    }
    const events = [
      'enterpictureinpicture',
      'leavepictureinpicture',
      'webkitpresentationmodechanged'
    ]
    tracks.addEventListener('addtrack', sync)
    tracks.addEventListener('removetrack', sync)
    for (const e of events) el.addEventListener(e, sync)
    return () => {
      tracks.removeEventListener('addtrack', sync)
      tracks.removeEventListener('removetrack', sync)
      for (const e of events) el.removeEventListener(e, sync)
      for (const t of tracks) t.removeEventListener('cuechange', onCue)
    }
  }, [media])
  return cues
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
  tracks,
  children
}: {
  media: RefObject<HTMLVideoElement | null>
  /** What goes fullscreen, the video with these controls over it, and
      where menus open. */
  stage: HTMLElement | null
  /** The item's runtime in seconds, until the media knows its own. */
  runtime: number
  /** Shown along the top with the controls. */
  header: ReactNode
  /** The audio and subtitle streams to choose between, if there's a choice. */
  tracks?: Tracks
  /** Over the video, under the controls, such as messages and panels. */
  children?: ReactNode
}) {
  const m = useMedia(media)
  const cues = useCaptions(media)
  // A stream still being made, in an HLS event playlist, says only how much
  // there is so far; the item's runtime is the whole of it.
  const duration = Math.max(m.duration, runtime)
  const [scrubbing, setScrubbing] = useState(false)
  const [active, setActive] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [airplay, setAirplay] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shown = active || !m.playing || scrubbing || menuOpen
  // The volume slider, folded beside its icon until that's clicked, and
  // folded again when the controls fade.
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [wasShown, setWasShown] = useState(shown)
  if (shown !== wasShown) {
    setWasShown(shown)
    if (!shown) setVolumeOpen(false)
  }

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
    if (el) togglePlay(el)
  }
  const seekTo = (t: number) => {
    const el = video()
    if (el) seek(el, t, duration)
  }
  const toggleFullscreen = () => {
    const d = document as WebKitDocument
    const el = stage as WebKitElement | null
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
          setVolumeOpen(true)
          setVolume(el, Math.min(1, el.volume + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolumeOpen(true)
          setVolume(el, Math.max(0, el.volume - 0.1))
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
      {cues.length > 0 && (
        <div className={styles.captions}>
          {cues.map((c, i) => (
            <span
              key={`${c.startTime}-${i}`}
              ref={(el) => el?.replaceChildren(c.getCueAsHTML())}
            />
          ))}
        </div>
      )}
      <div className={styles.bottom}>
        <Scrubber
          media={media}
          time={m.time}
          duration={duration}
          onHold={setScrubbing}
        />
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
          <Volume
            media={media}
            volume={m.volume}
            muted={m.muted}
            open={volumeOpen}
            onOpen={() => setVolumeOpen(true)}
          />
          <span className={styles.spacer} />
          {tracks &&
            (tracks.audio.length > 1 || tracks.subtitles.length > 0) && (
              <Menu
                side="top"
                align="end"
                // Inside the player, so it shows when that's full screen.
                container={stage}
                open={menuOpen}
                onOpenChange={(open) => {
                  setMenuOpen(open)
                  // A choice made, the controls stay a moment longer.
                  if (!open) wake()
                }}
                trigger={
                  <IconButton icon="subtitles" label="Audio and subtitles" />
                }
              >
                {tracks.audio.length > 1 && (
                  <>
                    <p className={styles.menuHeading}>Audio</p>
                    {tracks.audio.map((t) => (
                      <MenuItem
                        key={t.index}
                        trailingIcon={t.chosen ? 'check' : undefined}
                        onSelect={() => !t.chosen && tracks.onAudio(t.index)}
                      >
                        {t.label}
                      </MenuItem>
                    ))}
                  </>
                )}
                {tracks.audio.length > 1 && tracks.subtitles.length > 0 && (
                  <MenuDivider />
                )}
                {tracks.subtitles.length > 0 && (
                  <>
                    <p className={styles.menuHeading}>Subtitles</p>
                    <MenuItem
                      trailingIcon={
                        tracks.subtitles.some((t) => t.chosen)
                          ? undefined
                          : 'check'
                      }
                      onSelect={() => tracks.onSubtitle(-1)}
                    >
                      Off
                    </MenuItem>
                    {tracks.subtitles.map((t) => (
                      <MenuItem
                        key={t.index}
                        trailingIcon={t.chosen ? 'check' : undefined}
                        onSelect={() => !t.chosen && tracks.onSubtitle(t.index)}
                      >
                        {t.label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>
            )}
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
