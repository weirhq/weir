import type { InputHTMLAttributes } from 'react'
import styles from './radio.module.css'
import { StateLayer } from './state-layer'
import './tokens/radio-button.gen.css'

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/**
 * An M3 radio button, a native radio underneath: give radios in a set the
 * same name. Wrap it in a label with its text, or give it an aria-label.
 */
export function Radio({ className, ...props }: RadioProps) {
  return (
    <span
      className={[styles.radio, 'md-comp-radio-button', className]
        .filter(Boolean)
        .join(' ')}
    >
      <input type="radio" className={styles.input} {...props} />
      <StateLayer />
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden>
        <circle className={styles.ring} cx="10" cy="10" r="9" />
        <circle className={styles.dot} cx="10" cy="10" r="6" />
      </svg>
    </span>
  )
}
