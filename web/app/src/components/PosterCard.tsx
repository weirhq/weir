import { Link } from '@tanstack/react-router'
import { ItemKind, type ItemSummary } from '../gen/weir/api/v1alpha/browse_pb'
import { srcSet } from '../art'
import styles from './Cards.module.css'

/** Episodes and continue-watching rows show wide stills; the rest posters. */
export function isWide(item: ItemSummary): boolean {
  return item.kind === ItemKind.EPISODE
}

/** Music shows square pictures: artists, albums, and tracks' albums. */
export function isSquare(item: ItemSummary): boolean {
  return (
    item.kind === ItemKind.ARTIST ||
    item.kind === ItemKind.ALBUM ||
    item.kind === ItemKind.TRACK
  )
}

/** A line under the title: year, episode number, or track number. */
export function subtitle(item: ItemSummary): string {
  switch (item.kind) {
    case ItemKind.EPISODE:
      return `Episode ${item.indexNumber}`
    case ItemKind.SEASON:
      return ''
    case ItemKind.TRACK:
      return (
        item.parentTitle ||
        (item.indexNumber ? `Track ${item.indexNumber}` : '')
      )
    default:
      return item.year ? String(item.year) : ''
  }
}

export function PosterCard({
  item,
  wide = isWide(item)
}: {
  item: ItemSummary
  /** A 16:9 card with the wide picture, whatever the item. */
  wide?: boolean
}) {
  const image = wide ? item.thumbUrl || item.posterUrl : item.posterUrl
  // How far through it the viewer is, when it's part-watched.
  const seconds = (d?: { seconds: bigint }) => (d ? Number(d.seconds) : 0)
  const position = seconds(item.userData?.position)
  const runtime = seconds(item.duration)
  const progress =
    runtime && position && !item.userData?.watched
      ? Math.min(100, (position / runtime) * 100)
      : 0
  return (
    <Link
      to="/item/$itemId"
      params={{ itemId: item.id }}
      className={styles.card}
    >
      <div
        className={
          wide ? styles.still : isSquare(item) ? styles.square : styles.poster
        }
      >
        {image ? (
          <img
            src={`${image}&w=320`}
            srcSet={srcSet(image, 480)}
            sizes="(max-width: 600px) 45vw, 200px"
            alt=""
            loading="lazy"
          />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            {item.title.slice(0, 1)}
          </span>
        )}
        {item.userData?.watched && (
          <span className={styles.watched} aria-label="Watched">
            ✓
          </span>
        )}
        {progress > 0 && (
          <span
            className={styles.progress}
            aria-label={`${Math.round(progress)}% watched`}
          >
            <span style={{ width: `${progress}%` }} />
          </span>
        )}
      </div>
      <span className={styles.title}>{item.title}</span>
      <span className={styles.meta}>{subtitle(item)}</span>
    </Link>
  )
}
