import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import styles from './fab.module.css'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import { focusRing, StateLayer } from './state-layer'
import './tokens/fab-small.gen.css'
import './tokens/fab-baseline.gen.css'
import './tokens/fab-medium.gen.css'
import './tokens/fab-large.gen.css'
import './tokens/extended-fab-small.gen.css'
import './tokens/extended-fab-medium.gen.css'
import './tokens/extended-fab-large.gen.css'
import './tokens/fab-primary-container.gen.css'
import './tokens/fab-secondary-container.gen.css'

type FabColor = 'primary' | 'secondary'

type CommonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Primary or secondary container colours; primary by default. */
  color?: FabColor
}

const sizeTokens = {
  small: 'fab-small',
  baseline: 'fab-baseline',
  medium: 'fab-medium',
  large: 'fab-large'
}

function classes(
  color: FabColor,
  size: string,
  extra: (string | false | undefined)[]
) {
  return [
    styles.fab,
    styles[size],
    styles[color],
    focusRing,
    `md-comp-fab-${color}-container`,
    ...extra
  ]
    .filter(Boolean)
    .join(' ')
}

const icon = (i: IconName | ReactElement) =>
  typeof i === 'string' ? <Icon name={i} /> : i

export type FabProps = CommonProps & {
  /** A Material Symbol's name, or any element. */
  icon: IconName | ReactElement
  /** What the button does; there's no visible text to name it. */
  label: string
  /** 40, 56, 80 or 96dp; 56dp (baseline) by default. */
  size?: keyof typeof sizeTokens
}

/** An M3 Expressive floating action button: the screen's main action. */
export function Fab({
  icon: i,
  label,
  size = 'baseline',
  color = 'primary',
  className,
  ...props
}: FabProps) {
  return (
    <button
      aria-label={label}
      className={classes(color, size, [
        `md-comp-${sizeTokens[size]}`,
        className
      ])}
      {...props}
    >
      <StateLayer />
      {icon(i)}
    </button>
  )
}

export type ExtendedFabProps = CommonProps & {
  /** A leading Material Symbol's name, or any element. */
  icon?: IconName | ReactElement
  /** The label. */
  children: ReactNode
  /** 56, 80 or 96dp tall; 56dp (small) by default. */
  size?: 'small' | 'medium' | 'large'
}

/** An M3 Expressive extended FAB: the main action, with a label. */
export function ExtendedFab({
  icon: i,
  size = 'small',
  color = 'primary',
  className,
  children,
  ...props
}: ExtendedFabProps) {
  return (
    <button
      className={classes(color, size, [
        styles.extended,
        `md-comp-extended-fab-${size}`,
        className
      ])}
      {...props}
    >
      <StateLayer />
      {i && icon(i)}
      {children}
    </button>
  )
}
