import { Link } from '@tanstack/react-router'
import type { Person } from '../gen/weir/api/v1alpha/browse_pb'
import { sized, srcSet } from '../art'
import styles from './Cards.module.css'

/** "Reeve Carney" is "RC". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** A round photo, or initials without one, at a given size in pixels. */
export function PersonPhoto({
  name,
  photoUrl,
  size
}: {
  name: string
  photoUrl: string
  size: number
}) {
  return photoUrl ? (
    <img
      className={styles.personPhoto}
      style={{ width: size, height: size }}
      src={sized(photoUrl, size * 2)}
      srcSet={srcSet(photoUrl, size * 4)}
      sizes={`${size}px`}
      alt=""
      loading="lazy"
    />
  ) : (
    <span
      className={styles.personPhoto}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

/**
 * Someone in a cast, as Plex shows them: a round photo, their name and
 * who they play, leading to their page when we know who they are.
 */
export function PersonCard({ person }: { person: Person }) {
  const content = (
    <>
      <PersonPhoto name={person.name} photoUrl={person.photoUrl} size={96} />
      <span className={styles.personName}>{person.name}</span>
      {person.role && <span className={styles.meta}>{person.role}</span>}
    </>
  )
  return person.id ? (
    <Link
      to="/person/$personId"
      params={{ personId: person.id }}
      className={`${styles.card} ${styles.person}`}
    >
      {content}
    </Link>
  ) : (
    <div className={`${styles.card} ${styles.person}`}>{content}</div>
  )
}
