import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes, ReactElement } from 'react'
import { Icon } from './icon'
import styles from './icon-button.module.css'
import type { IconName } from './icon-names'
import { focusRing, StateLayer } from './state-layer'
import './tokens/x-small-icon-button.gen.css'
import './tokens/small-icon-button.gen.css'
import './tokens/medium-icon-button.gen.css'
import './tokens/large-icon-button.gen.css'
import './tokens/x-large-icon-button.gen.css'
import './tokens/standard-icon-button.gen.css'
import './tokens/filled-icon-button.gen.css'
import './tokens/filled-tonal-icon-button.gen.css'
import './tokens/outlined-icon-button.gen.css'

export type IconButtonSize = 'xs' | 's' | 'm' | 'l' | 'xl'

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'aria-pressed'
> & {
  /** A Material Symbol's name, which fills when selected, or any element. */
  icon: IconName | ReactElement
  /** What the button does; there's no visible text to name it. */
  label: string
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined'
  /** Extra small (32dp) to extra large (136dp); small (40dp) by default. */
  size?: IconButtonSize
  /** How much space beside the icon; uniform makes a square or circle. */
  width?: 'narrow' | 'uniform' | 'wide'
  shape?: 'round' | 'square'
  /** Makes the button a toggle, selected or not. */
  selected?: boolean
  /** Render the child element (e.g. a link) as the icon button instead. */
  asChild?: boolean
}

const sizeTokens: Record<IconButtonSize, string> = {
  xs: 'x-small',
  s: 'small',
  m: 'medium',
  l: 'large',
  xl: 'x-large'
}

const variantTokens = {
  standard: 'standard-icon-button',
  filled: 'filled-icon-button',
  tonal: 'filled-tonal-icon-button',
  outlined: 'outlined-icon-button'
}

/** An M3 Expressive icon button, optionally a toggle. */
export function IconButton({
  icon,
  label,
  variant = 'standard',
  size = 's',
  width = 'uniform',
  shape = 'round',
  selected,
  asChild = false,
  className,
  children,
  ...props
}: IconButtonProps) {
  const toggle = selected !== undefined
  const Component = asChild ? Slot.Root : 'button'
  return (
    <Component
      aria-label={label}
      aria-pressed={toggle ? selected : undefined}
      className={[
        styles.iconButton,
        styles[size],
        styles[width],
        styles[shape],
        styles[variant],
        toggle && styles.toggle,
        focusRing,
        `md-comp-${sizeTokens[size]}-icon-button`,
        `md-comp-${variantTokens[variant]}`,
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <StateLayer />
      {typeof icon === 'string' ? <Icon name={icon} filled={selected} /> : icon}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Component>
  )
}
