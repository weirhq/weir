import type { MouseEventHandler, ReactElement, ReactNode } from 'react'
import { Button, type ButtonSize } from './button'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import styles from './split-button.module.css'
import './tokens/split-button-x-small.gen.css'
import './tokens/split-button-small.gen.css'
import './tokens/split-button-medium.gen.css'
import './tokens/split-button-large.gen.css'
import './tokens/split-button-x-large.gen.css'

const sizeTokens: Record<ButtonSize, string> = {
  xs: 'x-small',
  s: 'small',
  m: 'medium',
  l: 'large',
  xl: 'x-large'
}

export type SplitButtonProps = {
  /** The action's label. */
  children: ReactNode
  /** A leading icon for the action. */
  icon?: IconName | ReactElement
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** Names the trailing button, e.g. "More ways to share". */
  menuLabel: string
  /** Whether the menu the trailing button opens is open. */
  menuOpen: boolean
  onMenuClick?: MouseEventHandler<HTMLButtonElement>
  variant?: 'filled' | 'tonal' | 'elevated' | 'outlined'
  /** Extra small (32dp) to extra large (136dp); small (40dp) by default. */
  size?: ButtonSize
  disabled?: boolean
  className?: string
}

/**
 * An M3 Expressive split button: an action, and beside it a button that
 * opens a menu of related actions. The menu itself is the caller's.
 */
export function SplitButton({
  children,
  icon,
  onClick,
  menuLabel,
  menuOpen,
  onMenuClick,
  variant = 'filled',
  size = 's',
  disabled,
  className
}: SplitButtonProps) {
  return (
    <div
      role="group"
      className={[
        styles.split,
        styles[size],
        `md-comp-split-button-${sizeTokens[size]}`,
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Button
        variant={variant}
        size={size}
        icon={icon}
        disabled={disabled}
        onClick={onClick}
        className={styles.leading}
      >
        {children}
      </Button>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={onMenuClick}
        className={styles.trailing}
        icon={<Icon name="keyboard_arrow_down" className={styles.chevron} />}
      />
    </div>
  )
}
