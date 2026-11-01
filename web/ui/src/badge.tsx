import type { HTMLAttributes, ReactNode } from 'react'
import styles from './badge.module.css'
import './tokens/badge.gen.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /** A count or short label for a large badge; none makes a small dot. */
  children?: ReactNode
}

/**
 * An M3 badge: a 6dp dot, or a 16dp pill holding a count. On its own it
 * says nothing to screen readers that its text doesn't, so label what it
 * marks, as in "Queue, 3 items".
 */
export function Badge({ children, className, ...props }: BadgeProps) {
  const large = children !== undefined && children !== null && children !== ''
  return (
    <span
      {...props}
      className={cx(
        styles.badge,
        large && styles.large,
        'md-comp-badge',
        className
      )}
    >
      {large && children}
    </span>
  )
}

export type BadgedBoxProps = {
  /** The Badge to show, or nothing for none. */
  badge?: ReactNode
  /** What it marks, usually an icon. */
  children: ReactNode
  className?: string
}

/**
 * Places a badge over the top end of its content, as Compose's BadgedBox
 * does: a dot 6dp in from the corner, a count 12dp in and 2dp above.
 */
export function BadgedBox({ badge, children, className }: BadgedBoxProps) {
  return (
    <span className={cx(styles.box, className)}>
      {children}
      {badge}
    </span>
  )
}
