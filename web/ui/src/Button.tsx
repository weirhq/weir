import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text'
  /** Render the child element (e.g. a link) with button styling instead. */
  asChild?: boolean
}

/** An M3 common button. */
export function Button({
  variant = 'filled',
  asChild = false,
  className,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button'
  return (
    <Component
      className={[styles.button, styles[variant], className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}
