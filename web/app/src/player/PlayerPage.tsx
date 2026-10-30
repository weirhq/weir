import { durationFromMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { Button } from '@weirhq/ui'
import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../errors'
import {
  PlaybackMethod,
  type PlaybackPlan
} from '../gen/weir/api/v1alpha/playback_pb'
import { playRoute } from '../router'
import { currentBrowser, detectCapabilities } from './capabilities'
import {
  actionNames,
  describeOutput,
  methodNames,
  reasonNames,
  warningNames
} from './explain'
import styles from './PlayerPage.module.css'

const heartbeatMs = 10_000

export function PlayerPage() {
  const { itemId } = playRoute.useParams()
  const { version } = playRoute.useSearch()
  const { api } = useRouteContext({ from: '__root__' })
  const video = useRef<HTMLVideoElement>(null)
  // The last position the video reported. By the time this page's effects
  // clean up, the element has been reset, so its currentTime reads zero.
  const position = useRef(0)
  const [showInfo, setShowInfo] = useState(false)
  const [mediaError, setMediaError] = useState('')

  const item = useQuery({
    queryKey: ['item', itemId],
    queryFn: async () => (await api.browse.getItem({ id: itemId })).item
  })
  // One session per visit: never refetched, never shared with another view.
  const start = useQuery({
    queryKey: ['play', itemId, version],
    queryFn: async () => {
      const resp = await api.playback.start({
        itemId,
        versionId: version,
        capabilities: detectCapabilities(currentBrowser())
      })
      return resp.plan!
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false
  })
  const plan = start.data
  const resumeMs = item.data?.summary?.userData?.position
    ? Number(item.data.summary.userData.position.seconds) * 1000
    : 0
  const itemLoaded = item.isSuccess || item.isError

  // Attach the media once both the plan and the resume point are known.
  useEffect(() => {
    const el = video.current
    if (!el || !plan?.url || !itemLoaded) return
    const startAt = resumeMs / 1000
    if (plan.method === PlaybackMethod.DIRECT_PLAY || !Hls.isSupported()) {
      // Direct play, or Safari's own HLS.
      el.src = plan.url
      const seek = () => {
        if (startAt > 0) el.currentTime = startAt
      }
      el.addEventListener('loadedmetadata', seek, { once: true })
      void el.play().catch(() => undefined)
      return () => {
        el.removeEventListener('loadedmetadata', seek)
        el.removeAttribute('src')
        el.load()
      }
    }
    const hls = new Hls({ startPosition: startAt > 0 ? startAt : -1 })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal)
        setMediaError('Playback stopped: the stream couldn’t be loaded.')
    })
    hls.loadSource(plan.url)
    hls.attachMedia(el)
    void el.play().catch(() => undefined)
    return () => hls.destroy()
  }, [plan, itemLoaded, resumeMs])

  // Report progress while mounted, and where it stopped on the way out.
  // Before anything has played there's no position to report, and sending
  // zero would wipe a resume point.
  useEffect(() => {
    if (!plan) return
    const reported = () =>
      position.current > 0
        ? durationFromMs(Math.round(position.current * 1000))
        : undefined
    const timer = setInterval(() => {
      void api.playback
        .heartbeat({ sessionId: plan.sessionId, itemId, position: reported() })
        .catch(() => undefined)
    }, heartbeatMs)
    return () => {
      clearInterval(timer)
      void api.playback
        .stop({ sessionId: plan.sessionId, itemId, position: reported() })
        .catch(() => undefined)
    }
  }, [api, plan, itemId])

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
      {start.isError && (
        <p className={styles.error} role="alert">
          {startError(start.error)}
        </p>
      )}
      {mediaError && (
        <p className={styles.error} role="alert">
          {mediaError}
        </p>
      )}
      <video
        ref={video}
        className={styles.video}
        controls
        playsInline
        onTimeUpdate={(e) => {
          position.current = e.currentTarget.currentTime
        }}
        onError={() =>
          plan && setMediaError('This browser couldn’t play the stream.')
        }
      />
      {plan && showInfo && <PlanPanel plan={plan} />}
    </div>
  )
}

function startError(err: unknown): string {
  const e = ConnectError.from(err)
  switch (e.code) {
    case Code.ResourceExhausted:
      return 'The server is busy with other playback. Try again when something else finishes.'
    case Code.PermissionDenied:
      return 'You can browse this library but not play from it. Ask an admin for access.'
    case Code.NotFound:
      return 'This item doesn’t exist, or isn’t shared with you.'
    case Code.FailedPrecondition:
      return 'There’s nothing playable for this item yet.'
  }
  return errorMessage(err)
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
