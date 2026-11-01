import {
  Children,
  createContext,
  useContext,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode
} from 'react'
import styles from './fab-menu.module.css'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import { StateLayer } from './state-layer'
import './tokens/fab-menu-baseline.gen.css'
import './tokens/fab-baseline.gen.css'
import './tokens/fab-medium.gen.css'
import './tokens/fab-large.gen.css'
import './tokens/fab-primary-container.gen.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

// Compose staggers the items with a SlowEffects spring (critically damped,
// stiffness 800) counting the visible items up from none, or down to none;
// an item shows once the count reaches it. The count is whole (truncated),
// and the spring stops within 1 of its target and snaps there, so the last
// item comes with the one before it. These are the times each changes.
const omega = Math.sqrt(800)
function staggerDelays(count: number, opening: boolean): number[] {
  const at = (t: number) =>
    opening
      ? count * (1 - (1 + omega * t) * Math.exp(-omega * t))
      : count * (1 + omega * t) * Math.exp(-omega * t)
  const when = (reached: (v: number) => boolean) => {
    let t = 0
    while (t < 2 && !reached(at(t))) t += 0.001
    return Math.round(t * 1000)
  }
  // Opening, the bottom item comes first; closing, the top one goes first.
  return Array.from({ length: count }, (_, i) =>
    opening
      ? when((v) => Math.trunc(v) >= Math.min(count - i, count - 1))
      : when((v) => Math.trunc(v) < count - i)
  )
}

type Menu = { close: () => void; closeOnSelect: boolean }
const MenuContext = createContext<Menu | null>(null)

export type FabMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the button does, read out; there's no visible text. */
  label: string
  /** The button's icon while closed; it shows a close icon while open. */
  icon?: IconName | ReactElement
  /** The FAB it starts as: 56, 80 or 96dp. */
  size?: 'baseline' | 'medium' | 'large'
  /** The side the button and items line up on. */
  align?: 'end' | 'start'
  /** Close after an item is chosen. On by default. */
  closeOnSelect?: boolean
  className?: string
  children?: ReactNode
}

/**
 * An M3 Expressive FAB menu: a FAB that opens a few related actions above
 * it. Place it, usually in the corner of the window; Escape closes it.
 */
export function FabMenu({
  open,
  onOpenChange,
  label,
  icon = 'add',
  size = 'baseline',
  align = 'end',
  closeOnSelect = true,
  className,
  children
}: FabMenuProps) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const items = Children.toArray(children)
  const delays = staggerDelays(items.length, open)
  const close = () => {
    onOpenChange(false)
    button.current?.focus()
  }
  return (
    <MenuContext.Provider value={{ close, closeOnSelect }}>
      <div
        className={cx(
          styles.menu,
          open && styles.open,
          align === 'start' && styles.start,
          styles[size],
          'md-comp-fab-menu-baseline',
          `md-comp-fab-${size}`,
          'md-comp-fab-primary-container',
          className
        )}
        onKeyDown={(e: KeyboardEvent) => {
          if (open && e.key === 'Escape') close()
        }}
      >
        <div className={styles.slot}>
          <button
            ref={button}
            type="button"
            className={styles.toggle}
            aria-label={label}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => onOpenChange(!open)}
          >
            {open ? (
              <Icon name="close" />
            ) : typeof icon === 'string' ? (
              <Icon name={icon} />
            ) : (
              icon
            )}
            <StateLayer />
          </button>
        </div>
        <ul id={id} className={styles.items} inert={!open}>
          {items.map((item, i) => (
            <li
              key={i}
              style={{ '--_delay': `${delays[i]}ms` } as CSSProperties}
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </MenuContext.Provider>
  )
}

export type FabMenuItemProps = {
  icon: IconName | ReactElement
  children: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
}

/** An action in a FabMenu. */
export function FabMenuItem({
  icon,
  children,
  onClick,
  className
}: FabMenuItemProps) {
  const menu = useContext(MenuContext)
  return (
    <button
      type="button"
      className={cx(styles.item, className)}
      onClick={(e) => {
        onClick?.(e)
        if (menu?.closeOnSelect) menu.close()
      }}
    >
      {typeof icon === 'string' ? <Icon name={icon} /> : icon}
      {children}
      <StateLayer />
    </button>
  )
}
