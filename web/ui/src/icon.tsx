import type { HTMLAttributes } from 'react'
import styles from './icon.module.css'
import type { IconName } from './icon-names'

export type IconProps = HTMLAttributes<HTMLSpanElement> & {
  /** A Material Symbol from icon-names.ts. */
  name: IconName
  /** Draw the icon filled, as selected toggles do. */
  filled?: boolean
}

/**
 * A Material Symbols Rounded icon. It's decorative: label the control it
 * sits in instead.
 */
export function Icon({ name, filled = false, className, ...props }: IconProps) {
  return (
    <span
      aria-hidden
      translate="no"
      className={[styles.icon, filled && styles.filled, className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {name}
    </span>
  )
}
