import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes, ReactElement } from 'react'
import styles from './button.module.css'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import { focusRing, StateLayer } from './state-layer'
import './tokens/button-x-small.gen.css'
import './tokens/button-small.gen.css'
import './tokens/button-medium.gen.css'
import './tokens/button-large.gen.css'
import './tokens/button-x-large.gen.css'
import './tokens/filled-button.gen.css'
import './tokens/filled-tonal-button.gen.css'
import './tokens/tonal-button.gen.css'
import './tokens/elevated-button.gen.css'
import './tokens/outlined-button.gen.css'
import './tokens/text-button.gen.css'

export type ButtonSize = 'xs' | 's' | 'm' | 'l' | 'xl'

type CommonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-pressed'
> & {
  /** Extra small (32dp) to extra large (136dp); small (40dp) by default. */
  size?: ButtonSize
  shape?: 'round' | 'square'
  /**
   * A leading icon: a Material Symbol's name, which fills when a toggle is
   * selected, or any element.
   */
  icon?: IconName | ReactElement
  /** Render the child element (e.g. a link) with button styling instead. */
  asChild?: boolean
}

export type ButtonProps = CommonProps &
  (
    | {
        variant?: 'filled' | 'tonal' | 'elevated' | 'outlined'
        /** Makes the button a toggle, selected or not. */
        selected?: boolean
      }
    // M3 has no text toggle buttons.
    | { variant: 'text'; selected?: never }
  )

const sizeTokens: Record<ButtonSize, string> = {
  xs: 'x-small',
  s: 'small',
  m: 'medium',
  l: 'large',
  xl: 'x-large'
}

const variantTokens = {
  filled: 'filled-button',
  tonal: 'filled-tonal-button',
  elevated: 'elevated-button',
  outlined: 'outlined-button',
  text: 'text-button'
}

/** An M3 Expressive button, optionally a toggle. */
export function Button({
  variant = 'filled',
  size = 's',
  shape = 'round',
  selected,
  icon,
  asChild = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const toggle = selected !== undefined
  const Component = asChild ? Slot.Root : 'button'
  return (
    <Component
      aria-pressed={toggle ? selected : undefined}
      className={[
        styles.button,
        styles[size],
        styles[shape],
        styles[variant],
        toggle && styles.toggle,
        focusRing,
        `md-comp-button-${sizeTokens[size]}`,
        `md-comp-${variantTokens[variant]}`,
        // Tonal toggles have their own tokens.
        toggle && variant === 'tonal' && 'md-comp-tonal-button',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <StateLayer />
      {icon && (
        <span className={styles.icon}>
          {typeof icon === 'string' ? (
            <Icon name={icon} filled={selected} />
          ) : (
            icon
          )}
        </span>
      )}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Component>
  )
}
