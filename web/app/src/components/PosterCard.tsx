import { Link } from '@tanstack/react-router'
import { ItemKind, type ItemSummary } from '../gen/weir/api/v1alpha/browse_pb'
import { srcSet } from '../art'
import styles from './Cards.module.css'

/** Episodes and continue-watching rows show wide stills; the rest posters. */
export function isWide(item: ItemSummary): boolean {
  return item.kind === ItemKind.EPISODE
}

/** A line under the title: year, episode number, or track number. */
export function subtitle(item: ItemSummary): string {
  switch (item.kind) {
    case ItemKind.EPISODE:
      return `Episode ${item.indexNumber}`
    case ItemKind.SEASON:
      return ''
    case ItemKind.TRACK:
      return item.indexNumber ? `Track ${item.indexNumber}` : ''
    default:
      return item.year ? String(item.year) : ''
  }
}

export function PosterCard({
  item,
  runtimeMs
}: {
  item: ItemSummary
  runtimeMs?: number
}) {
  const wide = isWide(item)
  const image = wide ? item.thumbUrl || item.posterUrl : item.posterUrl
  const position = item.userData?.position
    ? Number(item.userData.position.seconds) * 1000
    : 0
  const progress =
    runtimeMs && position ? Math.min(100, (position / runtimeMs) * 100) : 0
  return (
    <Link
      to="/item/$itemId"
      params={{ itemId: item.id }}
      className={styles.card}
    >
      <div className={wide ? styles.still : styles.poster}>
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
