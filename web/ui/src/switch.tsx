import type { InputHTMLAttributes } from 'react'
import { Icon } from './icon'
import styles from './switch.module.css'
import './tokens/switch.gen.css'

export type SwitchProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'role'
> & {
  /** Show a check in the handle when on and a cross when off. */
  icons?: boolean
}

/**
 * An M3 switch, for a setting that takes effect at once: a native checkbox
 * with role="switch" underneath. Wrap it in a label with its text, or
 * give it an aria-label.
 */
export function Switch({ icons = false, className, ...props }: SwitchProps) {
  return (
    <span
      className={[
        styles.switch,
        icons && styles.icons,
        'md-comp-switch',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type="checkbox"
        role="switch"
        className={styles.input}
        {...props}
      />
      <span className={styles.track} aria-hidden>
        <span className={styles.handle}>
          {icons && (
            <>
              <Icon name="check" className={styles.on} />
              <Icon name="close" className={styles.off} />
            </>
          )}
        </span>
      </span>
    </span>
  )
}
