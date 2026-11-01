import { Link } from '@tanstack/react-router'
import { BottomSheet, IconButton, List, ListItem, Tooltip } from '@weirhq/m3e'
import { useState, type RefObject } from 'react'
import type { ItemSummary } from '../gen/weir/api/v1alpha/browse_pb'
import { sized } from '../art'
import { Scrubber, togglePlay, useMedia, Volume } from './parts'
import { useQueue } from './queue'
import { startErrorMessage, usePlaybackSession } from './session'
import styles from './MiniPlayer.module.css'

/**
 * Plays the queue at the foot of every signed-in page, so music carries on
 * while browsing.
 */
export function MiniPlayer() {
  const { tracks, index, playId, next, previous, skipTo, clear } = useQueue()
  const [showQueue, setShowQueue] = useState(false)
  const track = tracks[index]
  const { media, startError, mediaError, setMediaError, onTimeUpdate } =
    usePlaybackSession<HTMLAudioElement>({
      itemId: track?.id,
      instance: playId,
      resumeMs: 0,
      ready: true
    })

  if (!track) return null
  const error = startError ? startErrorMessage(startError) : mediaError
  return (
    <section className={styles.bar} aria-label="Now playing">
      <BottomSheet open={showQueue} onOpenChange={setShowQueue} title="Queue">
        <List ordered className={styles.queue} aria-label="Queue">
          {tracks.map((t, i) => (
            <ListItem
              key={`${i}-${t.id}`}
              headline={t.title}
              onClick={() => skipTo(i)}
              selected={i === index}
              aria-current={i === index ? 'true' : undefined}
            />
          ))}
        </List>
      </BottomSheet>
      <div className={styles.row}>
        <div className={styles.now}>
          {track.posterUrl && (
            <img
              className={styles.art}
              src={sized(track.posterUrl, 96)}
              alt=""
            />
          )}
          <div className={styles.what}>
            <Link
              to="/item/$itemId"
              params={{ itemId: track.id }}
              className={styles.title}
            >
              {track.title}
            </Link>
            {error ? (
              <span className={styles.error} role="alert">
                {error}
              </span>
            ) : (
              <span className={styles.position}>
                {index + 1} of {tracks.length}
              </span>
            )}
          </div>
        </div>
        <audio
          ref={media}
          onTimeUpdate={onTimeUpdate}
          onEnded={next}
          onError={() => setMediaError('This browser couldn’t play the track.')}
        />
        <Controls
          media={media}
          track={track}
          first={index === 0}
          last={index + 1 >= tracks.length}
          onPrevious={previous}
          onNext={next}
          onQueue={() => setShowQueue(true)}
          onClose={clear}
        />
      </div>
    </section>
  )
}

/**
 * Weir's own controls for the track, as the video player has: play between
 * the skips with the scrubber under them, then the volume, the queue and a
 * way to close. Mounted with the audio element, so they follow it.
 */
function Controls({
  media,
  track,
  first,
  last,
  onPrevious,
  onNext,
  onQueue,
  onClose
}: {
  media: RefObject<HTMLAudioElement | null>
  track: ItemSummary
  first: boolean
  last: boolean
  onPrevious: () => void
  onNext: () => void
  onQueue: () => void
  onClose: () => void
}) {
  const m = useMedia(media)
  // A track still being transcoded says only how much there is so far.
  const duration = Math.max(m.duration, Number(track.duration?.seconds ?? 0))
  // The volume slider folds again once the pointer leaves the player.
  const [volumeOpen, setVolumeOpen] = useState(false)
  return (
    <>
      <div className={styles.transport}>
        <div className={styles.buttons}>
          <Tooltip text="Previous track">
            <IconButton
              icon="skip_previous"
              label="Previous track"
              disabled={first}
              onClick={onPrevious}
            />
          </Tooltip>
          <IconButton
            icon={m.playing ? 'pause' : 'play_arrow'}
            label={m.playing ? 'Pause' : 'Play'}
            variant="filled"
            onClick={() => media.current && togglePlay(media.current)}
          />
          <Tooltip text="Next track">
            <IconButton
              icon="skip_next"
              label="Next track"
              disabled={last}
              onClick={onNext}
            />
          </Tooltip>
        </div>
        <Scrubber media={media} time={m.time} duration={duration} />
      </div>
      <div
        className={styles.end}
        onPointerLeave={(e) =>
          e.pointerType === 'mouse' && setVolumeOpen(false)
        }
      >
        <Volume
          media={media}
          volume={m.volume}
          muted={m.muted}
          open={volumeOpen}
          onOpen={() => setVolumeOpen(true)}
          leftwards
        />
        <Tooltip text="Queue">
          <IconButton
            icon="queue_music"
            label="Queue"
            aria-haspopup="dialog"
            onClick={onQueue}
          />
        </Tooltip>
        <Tooltip text="Close player">
          <IconButton icon="close" label="Close player" onClick={onClose} />
        </Tooltip>
      </div>
    </>
  )
}
