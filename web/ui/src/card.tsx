import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import styles from './card.module.css'
import { focusRing, StateLayer } from './state-layer'
import './tokens/filled-card.gen.css'
import './tokens/elevated-card.gen.css'
import './tokens/outlined-card.gen.css'

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** Filled by default, as in Compose. */
  variant?: 'filled' | 'elevated' | 'outlined'
  /** Makes the card a button. Keep its content to text and images. */
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
  /** Only for a card with onClick. */
  disabled?: boolean
  /**
   * Render the child element as the card, such as a section, a list item
   * or a link. A link gets the hover, focus and press states.
   */
  asChild?: boolean
  children?: ReactNode
}

/** An M3 card: a container for content about one subject. */
export function Card({
  variant = 'filled',
  onClick,
  disabled,
  asChild = false,
  className,
  children,
  ...props
}: CardProps) {
  const classes = [
    styles.card,
    styles[variant],
    focusRing,
    `md-comp-${variant}-card`,
    // The disabled outline is composited over the elevated container.
    variant === 'outlined' && 'md-comp-elevated-card',
    className
  ]
    .filter(Boolean)
    .join(' ')
  if (onClick)
    return (
      <button
        type="button"
        className={classes}
        disabled={disabled}
        onClick={onClick}
        {...props}
      >
        <StateLayer />
        {children}
      </button>
    )
  if (asChild)
    return (
      <Slot.Root className={classes} {...props}>
        <StateLayer className={styles.layer} />
        <Slot.Slottable>{children}</Slot.Slottable>
      </Slot.Root>
    )
  return (
    <div className={classes} {...props}>
      {children}
    </div>
  )
}
