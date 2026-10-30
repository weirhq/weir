import { durationFromMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../errors'
import { PlaybackMethod } from '../gen/weir/api/v1alpha/playback_pb'
import { currentBrowser, detectCapabilities } from './capabilities'

const heartbeatMs = 10_000

type Options = {
  // Nothing plays while undefined.
  itemId: string | undefined
  versionId?: string
  // Distinguishes two plays of the same item, e.g. a repeat in a queue.
  instance?: number
  resumeMs: number
  // Whether resumeMs is known yet; media attaches only once it is.
  ready: boolean
}

/**
 * One playback of one item: starts it on the server, attaches the media
 * (the file directly, or HLS through hls.js or Safari), reports progress
 * every 10 s, and records where it stopped when the item changes or the
 * component goes away.
 */
export function usePlaybackSession<T extends HTMLMediaElement>({
  itemId,
  versionId,
  instance = 0,
  resumeMs,
  ready
}: Options) {
  const { api } = useRouteContext({ from: '__root__' })
  // The last position the media reported. By the time effects clean up, the
  // element has been reset and its currentTime reads zero.
  const position = useRef(0)
  const media = useRef<T>(null)
  // An error belongs to the plan that hit it, and goes when another starts.
  const [failure, setFailure] = useState<{ plan: object; message: string }>()

  // One session per play: never refetched, never shared with another play.
  const start = useQuery({
    queryKey: ['play', itemId, versionId, instance],
    enabled: itemId !== undefined,
    queryFn: async () => {
      const resp = await api.playback.start({
        itemId: itemId!,
        versionId,
        capabilities: detectCapabilities(currentBrowser())
      })
      return resp.plan!
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false
  })
  const plan = start.data
  const mediaError = failure && failure.plan === plan ? failure.message : ''
  const setMediaError = (message: string) =>
    plan && setFailure({ plan, message })

  useEffect(() => {
    const el = media.current
    if (!el || !plan?.url || !ready) return
    position.current = 0
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
        setFailure({
          plan,
          message: 'Playback stopped: the stream couldn’t be loaded.'
        })
    })
    hls.loadSource(plan.url)
    hls.attachMedia(el)
    void el.play().catch(() => undefined)
    return () => hls.destroy()
  }, [media, plan, ready, resumeMs])

  // Report progress while playing, and where it stopped on the way out.
  // Before anything has played there's no position to report, and sending
  // zero would wipe a resume point.
  useEffect(() => {
    if (!plan || !itemId) return
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

  return {
    // For the <video> or <audio> element's ref.
    media,
    plan,
    startError: start.error,
    mediaError,
    setMediaError,
    onTimeUpdate: (e: { currentTarget: HTMLMediaElement }) => {
      position.current = e.currentTarget.currentTime
    }
  }
}

/** Why the server wouldn't start playback, in words. */
export function startErrorMessage(err: unknown): string {
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
