import { Link } from '@tanstack/react-router'
import { Button } from '@weirhq/m3e'
import { useState } from 'react'
import { sized } from '../art'
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
      {showQueue && (
        <ol className={styles.queue} aria-label="Queue">
          {tracks.map((t, i) => (
            <li key={`${i}-${t.id}`}>
              <button
                type="button"
                className={styles.queueItem}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => skipTo(i)}
              >
                {t.title}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className={styles.row}>
        {track.posterUrl && (
          <img className={styles.art} src={sized(track.posterUrl, 96)} alt="" />
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
        <Button
          variant="text"
          aria-label="Previous track"
          disabled={index === 0}
          onClick={previous}
        >
          ⏮
        </Button>
        <audio
          ref={media}
          className={styles.audio}
          controls
          onTimeUpdate={onTimeUpdate}
          onEnded={next}
          onError={() => setMediaError('This browser couldn’t play the track.')}
        />
        <Button
          variant="text"
          aria-label="Next track"
          disabled={index + 1 >= tracks.length}
          onClick={next}
        >
          ⏭
        </Button>
        <Button
          variant="text"
          aria-expanded={showQueue}
          onClick={() => setShowQueue(!showQueue)}
        >
          Queue
        </Button>
        <Button variant="text" aria-label="Close player" onClick={clear}>
          ✕
        </Button>
      </div>
    </section>
  )
}
