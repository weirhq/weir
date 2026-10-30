import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import { Button } from '@weirhq/ui'
import { AddToPlaylist } from '../components/AddToPlaylist'
import { PosterCard } from '../components/PosterCard'
import cards from '../components/Cards.module.css'
import {
  ItemKind,
  StreamKind,
  type Item,
  type ItemSummary,
  type Version
} from '../gen/weir/api/v1alpha/browse_pb'
import { HdrFormat } from '../gen/weir/api/v1alpha/playback_pb'
import { srcSet, sized } from '../art'
import { useQueue } from '../player/queue'
import { itemRoute } from '../router'
import styles from './ItemPage.module.css'

const playable = new Set([ItemKind.MOVIE, ItemKind.EPISODE, ItemKind.TRACK])

// What each kind lists beneath itself.
const childHeading: Partial<Record<ItemKind, string>> = {
  [ItemKind.SHOW]: 'Seasons',
  [ItemKind.SEASON]: 'Episodes',
  [ItemKind.ARTIST]: 'Albums',
  [ItemKind.ALBUM]: 'Tracks'
}

export function ItemPage() {
  const { itemId } = itemRoute.useParams()
  const { api } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const startQueue = useQueue((q) => q.start)
  const item = useQuery({
    queryKey: ['item', itemId],
    queryFn: async () => (await api.browse.getItem({ id: itemId })).item
  })
  const kind = item.data?.summary?.kind
  const children = useQuery({
    queryKey: ['children', itemId],
    enabled: kind !== undefined && childHeading[kind] !== undefined,
    queryFn: async () =>
      (await api.browse.listItems({ parentId: itemId, pageSize: 500 })).items
  })
  const setWatched = useMutation({
    mutationFn: (watched: boolean) =>
      api.playback.setWatched({ itemId, watched }),
    onSuccess: () => queryClient.invalidateQueries()
  })

  if (item.isError)
    return (
      <p className={cards.empty}>
        This item doesn’t exist, or isn’t shared with you.
      </p>
    )
  if (!item.data?.summary) return null
  const it = item.data
  const sum = it.summary!
  const watched = sum.userData?.watched ?? false
  const resumeMs = sum.userData?.position
    ? Number(sum.userData.position.seconds) * 1000
    : 0

  return (
    <article className={styles.page}>
      {it.backdropUrl && (
        <div className={styles.backdrop} aria-hidden="true">
          <img
            src={sized(it.backdropUrl, 1280)}
            srcSet={srcSet(it.backdropUrl, 1920)}
            sizes="100vw"
            alt=""
          />
        </div>
      )}
      <Breadcrumbs ancestors={it.ancestors} />
      <div className={styles.head}>
        {sum.posterUrl && (
          <img
            className={styles.poster}
            src={sized(sum.posterUrl, 480)}
            srcSet={srcSet(sum.posterUrl, 780)}
            sizes="240px"
            alt=""
          />
        )}
        <div className={styles.info}>
          <h1 className={styles.title}>{sum.title}</h1>
          <Facts item={it} />
          {it.tagline && <p className={styles.tagline}>{it.tagline}</p>}
          {it.overview && <p className={styles.overview}>{it.overview}</p>}
          <div className={styles.actions}>
            {sum.kind === ItemKind.TRACK && it.versions.length > 0 && (
              <Button onClick={() => startQueue([sum])}>Play</Button>
            )}
            {sum.kind === ItemKind.ALBUM &&
              (children.data?.length ?? 0) > 0 && (
                <Button onClick={() => startQueue(children.data!)}>
                  Play album
                </Button>
              )}
            {playable.has(sum.kind) &&
              sum.kind !== ItemKind.TRACK &&
              it.versions.length > 0 && (
                <Button asChild>
                  <Link to="/play/$itemId" params={{ itemId }}>
                    {resumeMs > 0 ? `Resume from ${clock(resumeMs)}` : 'Play'}
                  </Link>
                </Button>
              )}
            {playable.has(sum.kind) && it.versions.length > 0 && (
              <AddToPlaylist itemId={itemId} />
            )}
            {sum.kind !== ItemKind.ARTIST &&
              sum.kind !== ItemKind.ALBUM &&
              sum.kind !== ItemKind.TRACK && (
                <Button
                  variant="tonal"
                  disabled={setWatched.isPending}
                  onClick={() => setWatched.mutate(!watched)}
                >
                  {watched ? 'Mark unwatched' : 'Mark watched'}
                </Button>
              )}
          </div>
        </div>
      </div>

      {kind !== undefined && childHeading[kind] && (
        <section className={cards.section}>
          <h2 className={cards.heading}>{childHeading[kind]}</h2>
          {kind === ItemKind.SEASON || kind === ItemKind.ALBUM ? (
            <TrackList
              items={children.data ?? []}
              onPlay={
                kind === ItemKind.ALBUM
                  ? (i) => startQueue(children.data!, i)
                  : undefined
              }
            />
          ) : (
            <div className={cards.grid}>
              {(children.data ?? []).map((c) => (
                <PosterCard key={c.id} item={c} />
              ))}
            </div>
          )}
        </section>
      )}

      {it.cast.length > 0 && (
        <section className={cards.section}>
          <h2 className={cards.heading}>Cast</h2>
          <ul className={styles.cast}>
            {it.cast.slice(0, 12).map((p) => (
              <li key={p.name + p.role}>
                <span className={styles.castName}>{p.name}</span>
                {p.role && <span className={styles.castRole}>{p.role}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {it.versions.length > 0 && (
        <section className={cards.section}>
          <h2 className={cards.heading}>
            {it.versions.length === 1 ? 'File' : 'Versions'}
          </h2>
          <ul className={styles.versions}>
            {it.versions.map((v) => (
              <li key={v.id}>
                <VersionLine version={v} />
                {it.versions.length > 1 && (
                  <>
                    {' · '}
                    <Link
                      to="/play/$itemId"
                      params={{ itemId }}
                      search={{ version: v.id }}
                    >
                      Play this version
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

function Breadcrumbs({ ancestors }: { ancestors: ItemSummary[] }) {
  if (ancestors.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      {ancestors.map((a) => (
        <Link key={a.id} to="/item/$itemId" params={{ itemId: a.id }}>
          {a.title}
        </Link>
      ))}
    </nav>
  )
}

function Facts({ item }: { item: Item }) {
  const facts = [
    item.summary?.year ? String(item.summary.year) : '',
    item.contentRating,
    item.runtimeMinutes
      ? `${Math.floor(item.runtimeMinutes / 60) ? `${Math.floor(item.runtimeMinutes / 60)} h ` : ''}${item.runtimeMinutes % 60} min`
      : '',
    item.rating ? `★ ${item.rating.toFixed(1)}` : '',
    item.genres.slice(0, 3).join(', ')
  ].filter(Boolean)
  return facts.length > 0 ? (
    <p className={styles.facts}>{facts.join(' · ')}</p>
  ) : null
}

/**
 * Episodes and tracks: a numbered list rather than a grid of cards. With
 * onPlay, each row plays the list from there.
 */
function TrackList({
  items,
  onPlay
}: {
  items: ItemSummary[]
  onPlay?: (index: number) => void
}) {
  const playing = useQueue((q) => q.tracks[q.index]?.id)
  return (
    <ol className={styles.tracks}>
      {items.map((t, i) => (
        <li
          key={t.id}
          className={styles.trackRow}
          aria-current={t.id === playing ? 'true' : undefined}
        >
          <Link
            to="/item/$itemId"
            params={{ itemId: t.id }}
            className={styles.track}
          >
            <span className={styles.trackNumber}>{t.indexNumber || ''}</span>
            <span className={styles.trackTitle}>{t.title}</span>
            {t.userData?.watched && <span aria-label="Watched">✓</span>}
          </Link>
          {onPlay && (
            <Button
              variant="text"
              aria-label={`Play ${t.title}`}
              onClick={() => onPlay(i)}
            >
              ▶
            </Button>
          )}
        </li>
      ))}
    </ol>
  )
}

const hdrNames: Partial<Record<HdrFormat, string>> = {
  [HdrFormat.HDR10]: 'HDR10',
  [HdrFormat.HDR10_PLUS]: 'HDR10+',
  [HdrFormat.HLG]: 'HLG',
  [HdrFormat.DOLBY_VISION]: 'Dolby Vision'
}

/** "Director's Cut · 2160p HEVC Dolby Vision · English TrueHD 7.1 · 54.2 GB" */
function VersionLine({ version }: { version: Version }) {
  const video = version.streams.find((s) => s.kind === StreamKind.VIDEO)
  const audio = version.streams.find((s) => s.kind === StreamKind.AUDIO)
  const subs = version.streams.filter(
    (s) => s.kind === StreamKind.SUBTITLE
  ).length
  const parts = [
    version.edition,
    video &&
      [
        video.height ? `${video.height}p` : '',
        video.codec.toUpperCase(),
        hdrNames[video.hdrFormat] ?? ''
      ]
        .filter(Boolean)
        .join(' '),
    audio &&
      [
        languageName(audio.language),
        audio.codec.toUpperCase(),
        channels(audio.channels)
      ]
        .filter(Boolean)
        .join(' '),
    subs ? `${subs} subtitle${subs === 1 ? '' : 's'}` : '',
    size(Number(version.sizeBytes))
  ].filter(Boolean)
  return <>{parts.join(' · ')}</>
}

/** 54.2 GB, or 740 MB under a gigabyte. */
function size(bytes: number): string {
  if (!bytes) return ''
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

function channels(n: number): string {
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

function languageName(tag: string): string {
  if (!tag) return ''
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** 1:05:09 or 5:09. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
