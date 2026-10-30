import { useQuery } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { Button } from '@weirhq/ui'
import { useEffect, useState } from 'react'
import type { PlaybackPlan } from '../gen/weir/api/v1alpha/playback_pb'
import { playRoute } from '../router'
import {
  actionNames,
  describeOutput,
  methodNames,
  reasonNames,
  warningNames
} from './explain'
import { useQueue } from './queue'
import { startErrorMessage, usePlaybackSession } from './session'
import styles from './PlayerPage.module.css'

export function PlayerPage() {
  const { itemId } = playRoute.useParams()
  const { version } = playRoute.useSearch()
  const { api } = useRouteContext({ from: '__root__' })
  const [showInfo, setShowInfo] = useState(false)
  // A film or episode takes over from music.
  useEffect(() => useQueue.getState().clear(), [])

  const item = useQuery({
    queryKey: ['item', itemId],
    queryFn: async () => (await api.browse.getItem({ id: itemId })).item
  })
  const resumeMs = item.data?.summary?.userData?.position
    ? Number(item.data.summary.userData.position.seconds) * 1000
    : 0
  const { media, plan, startError, mediaError, setMediaError, onTimeUpdate } =
    usePlaybackSession<HTMLVideoElement>({
      itemId,
      versionId: version,
      resumeMs,
      ready: item.isSuccess || item.isError
    })

  const title = item.data?.summary?.title ?? ''
  return (
    <div className={styles.stage}>
      <header className={styles.top}>
        <Link to="/item/$itemId" params={{ itemId }} className={styles.back}>
          ‹ {title || 'Back'}
        </Link>
        {plan && (
          <Button
            variant="text"
            className={styles.infoButton}
            aria-expanded={showInfo}
            onClick={() => setShowInfo(!showInfo)}
          >
            {showInfo ? 'Hide info' : 'Info'}
          </Button>
        )}
      </header>
      {startError && (
        <p className={styles.error} role="alert">
          {startErrorMessage(startError)}
        </p>
      )}
      {mediaError && (
        <p className={styles.error} role="alert">
          {mediaError}
        </p>
      )}
      <video
        ref={media}
        className={styles.video}
        controls
        playsInline
        onTimeUpdate={onTimeUpdate}
        onError={() => setMediaError('This browser couldn’t play the stream.')}
      />
      {plan && showInfo && <PlanPanel plan={plan} />}
    </div>
  )
}

/** Why it plays the way it does (spec §8): method, output, each stream. */
function PlanPanel({ plan }: { plan: PlaybackPlan }) {
  return (
    <aside className={styles.panel} aria-label="Playback info">
      <h2>{methodNames[plan.method]}</h2>
      <p>{describeOutput(plan)}</p>
      <ul>
        {plan.streams.map((s) => (
          <li key={s.index}>
            Stream {s.index}: {actionNames[s.action]}
            {s.reasons.length > 0 && (
              <>
                {' '}
                because {s.reasons.map((r) => reasonNames[r]).join(', and ')}
              </>
            )}
          </li>
        ))}
      </ul>
      {plan.warnings.map((w) => (
        <p key={w} className={styles.warning}>
          {warningNames[w]}
        </p>
      ))}
    </aside>
  )
}
