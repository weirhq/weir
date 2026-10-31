import { useEffect, useRef, type InputHTMLAttributes } from 'react'
import styles from './checkbox.module.css'
import { StateLayer } from './state-layer'
import './tokens/checkbox.gen.css'

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> & {
  /** Shows a dash for "some of these", whatever `checked` is. */
  indeterminate?: boolean
}

/**
 * An M3 checkbox, a native checkbox underneath. Wrap it in a label with
 * its text, or give it an aria-label.
 */
export function Checkbox({
  indeterminate = false,
  className,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <span
      className={[styles.checkbox, 'md-comp-checkbox', className]
        .filter(Boolean)
        .join(' ')}
    >
      <input ref={ref} type="checkbox" className={styles.input} {...props} />
      <StateLayer />
      <svg className={styles.box} viewBox="0 0 18 18" aria-hidden>
        {/* The 2dp stroke sits inside the box (Checkbox.kt drawBox). */}
        <rect
          className={styles.outline}
          x="1"
          y="1"
          width="16"
          height="16"
          rx="1"
        />
        <path className={styles.mark} pathLength="1" />
      </svg>
    </span>
  )
}
