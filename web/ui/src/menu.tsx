import { DropdownMenu } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import styles from './menu.module.css'
import { StateLayer } from './state-layer'
import './tokens/menu.gen.css'
import './tokens/list.gen.css'
import './tokens/divider.gen.css'

const iconOf = (i: IconName | ReactElement) =>
  typeof i === 'string' ? <Icon name={i} /> : i

export type MenuProps = {
  /** The element that opens the menu, such as an IconButton. */
  trigger: ReactElement
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Which side of the trigger the menu opens on; below by default. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
}

/**
 * An M3 menu of actions, opened from its trigger. Radix handles focus,
 * keyboard and placement; the look is Compose's DropdownMenu.
 */
export function Menu({
  trigger,
  children,
  open,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  className
}: MenuProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={align}
          // MenuHorizontalMargin from the window's edges.
          collisionPadding={8}
          className={[styles.menu, 'md-comp-menu', 'md-comp-list', className]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export type MenuItemProps = {
  children: ReactNode
  /** A leading Material Symbol's name, or any element. */
  icon?: IconName | ReactElement
  /** A trailing Material Symbol's name, or any element, such as a
   * keyboard shortcut. */
  trailingIcon?: IconName | ReactElement
  onSelect?: (event: Event) => void
  disabled?: boolean
}

/** An action in a Menu. */
export function MenuItem({
  children,
  icon,
  trailingIcon,
  onSelect,
  disabled
}: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={styles.item}
      onSelect={onSelect}
      disabled={disabled}
    >
      <StateLayer />
      {icon && <span className={styles.leading}>{iconOf(icon)}</span>}
      <span className={styles.text}>{children}</span>
      {trailingIcon && (
        <span className={styles.trailing}>{iconOf(trailingIcon)}</span>
      )}
    </DropdownMenu.Item>
  )
}

/** A line between groups of items in a Menu. */
export function MenuDivider() {
  return (
    <DropdownMenu.Separator className={`${styles.divider} md-comp-divider`} />
  )
}
