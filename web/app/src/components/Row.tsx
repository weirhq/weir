import type { ReactNode } from 'react'
import styles from './Cards.module.css'

/** A titled, horizontally scrolling row of cards. Renders nothing when empty. */
export function Row({
  title,
  wide,
  children
}: {
  title: string
  wide?: boolean
  children: ReactNode[]
}) {
  if (children.length === 0) return null
  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      <div className={wide ? `${styles.row} ${styles.wide}` : styles.row}>
        {children}
      </div>
    </section>
  )
}
