import { Label } from 'radix-ui'
import { useId, type InputHTMLAttributes } from 'react'
import styles from './text-field.module.css'

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  /** Shown under the field, and marks it invalid. */
  error?: string
}

/** An M3 outlined text field. */
export function TextField({
  label,
  error,
  id,
  className,
  ...props
}: TextFieldProps) {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  const errorId = `${inputId}-error`
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <Label.Root className={styles.label} htmlFor={inputId}>
        {label}
      </Label.Root>
      <input
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
