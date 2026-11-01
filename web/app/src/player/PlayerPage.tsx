import { useQuery } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { Button, IconButton } from '@weirhq/m3e'
import { useEffect, useState } from 'react'
import { StreamKind, type Item } from '../gen/weir/api/v1alpha/browse_pb'
import type { PlaybackPlan } from '../gen/weir/api/v1alpha/playback_pb'
import { playRoute } from '../router'
import {
  actionNames,
  describeOutput,
  methodNames,
  reasonNames,
  warningNames
} from './explain'
import { channels, codecName, languageName } from '../streams'
import { PlayerControls, type Track } from './PlayerControls'
import { useQueue } from './queue'
import { startErrorMessage, usePlaybackSession } from './session'
import styles from './PlayerPage.module.css'

export function PlayerPage() {
  const { itemId } = playRoute.useParams()
  const { version, from } = playRoute.useSearch()
  const { api } = useRouteContext({ from: '__root__' })
  const [showInfo, setShowInfo] = useState(false)
  // A film or episode takes over from music.
  useEffect(() => useQueue.getState().clear(), [])

  const item = useQuery({
    queryKey: ['item', itemId],
    queryFn: async () => (await api.browse.getItem({ id: itemId })).item
  })
  // Streams chosen in the menu, and where it was when they were.
  const [choice, setChoice] = useState<{
    audio?: number
    subtitle?: number
    atMs?: number
  }>({})
  const resumeMs =
    choice.atMs ??
    (from !== 'start' && item.data?.summary?.userData?.position
      ? Number(item.data.summary.userData.position.seconds) * 1000
      : 0)
  const { media, plan, startError, mediaError, setMediaError, onTimeUpdate } =
    usePlaybackSession<HTMLVideoElement>({
      itemId,
      versionId: version,
      audioStream: choice.audio,
      subtitleStream: choice.subtitle,
      resumeMs,
      ready: item.isSuccess || item.isError
    })
  // Another stream starts a new session, from where this one was.
  const choose = (pick: { audio?: number; subtitle?: number }) =>
    setChoice((c) => ({
      ...c,
      ...pick,
      atMs: Math.round((media.current?.currentTime ?? 0) * 1000)
    }))
  const subtitle = plan?.subtitleUrl
    ? streamsOf(item.data, plan)?.find(
        (s) =>
          s.kind === StreamKind.SUBTITLE &&
          plan.streams.some((d) => d.index === s.index)
      )
    : undefined

  const title = item.data?.summary?.title ?? ''
  const runtime = Number(item.data?.summary?.duration?.seconds ?? 0)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setStage} className={styles.stage}>
      <video
        ref={media}
        className={styles.video}
        playsInline
        onTimeUpdate={onTimeUpdate}
        onError={() => setMediaError('This browser couldn’t play the stream.')}
      >
        {/* A text subtitle, as WebVTT beside the video; the controls draw
            its captions. */}
        {plan?.subtitleUrl && (
          <track
            key={plan.subtitleUrl}
            kind="subtitles"
            src={plan.subtitleUrl}
            srcLang={subtitle?.language || undefined}
            label={subtitle ? trackLabel(subtitle) : 'Subtitles'}
          />
        )}
      </video>
      <PlayerControls
        media={media}
        stage={stage}
        runtime={runtime}
        tracks={
          plan && {
            ...tracksOf(item.data, plan),
            onAudio: (audio) => choose({ audio }),
            onSubtitle: (subtitle) => choose({ subtitle })
          }
        }
        header={
          <>
            <div className={styles.heading}>
              <IconButton
                asChild
                icon="arrow_back"
                label={title ? `Back to ${title}` : 'Back'}
                className={styles.back}
              >
                <Link to="/item/$itemId" params={{ itemId }} />
              </IconButton>
              {title && <h1 className={styles.title}>{title}</h1>}
            </div>
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
          </>
        }
      >
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
        {plan && showInfo && <PlanPanel plan={plan} />}
      </PlayerControls>
    </div>
  )
}

type StreamInfo = Item['versions'][number]['streams'][number]

/** The streams of the version playing. */
function streamsOf(item: Item | undefined, plan: PlaybackPlan) {
  return item?.versions.find((v) => v.id === plan.versionId)?.streams
}

/** "English · Dolby Digital Plus 5.1", or a stream's own title. */
function trackLabel(s: StreamInfo): string {
  const language = languageName(s.language)
  if (s.kind === StreamKind.SUBTITLE)
    return [language || 'Unknown', s.title, s.forced && 'forced']
      .filter(Boolean)
      .join(' · ')
  return [
    language,
    s.title ||
      [codecName(s.codec), channels(s.channels)].filter(Boolean).join(' ')
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The audio and subtitle streams to choose from, the playing ones chosen. */
function tracksOf(
  item: Item | undefined,
  plan: PlaybackPlan
): { audio: Track[]; subtitles: Track[] } {
  const playing = new Set(plan.streams.map((d) => d.index))
  const of = (kind: StreamKind) =>
    (streamsOf(item, plan) ?? [])
      .filter((s) => s.kind === kind)
      .map((s) => ({
        index: s.index,
        label: trackLabel(s),
        chosen: playing.has(s.index)
      }))
  return { audio: of(StreamKind.AUDIO), subtitles: of(StreamKind.SUBTITLE) }
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
