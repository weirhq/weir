import { Slot } from 'radix-ui'
import {
  Children,
  createContext,
  useContext,
  type CSSProperties,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode
} from 'react'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import styles from './navigation.module.css'
import { StateLayer } from './state-layer'
import './tokens/navigation-bar.gen.css'
import './tokens/navigation-bar-vertical-item.gen.css'
import './tokens/navigation-bar-horizontal-item.gen.css'
import './tokens/navigation-rail-collapsed.gen.css'
import './tokens/navigation-rail-expanded.gen.css'
import './tokens/navigation-rail-color.gen.css'
import './tokens/navigation-rail-horizontal-item.gen.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

const tokens = [
  'md-comp-navigation-bar',
  'md-comp-navigation-bar-vertical-item',
  'md-comp-navigation-bar-horizontal-item',
  'md-comp-navigation-rail-collapsed',
  'md-comp-navigation-rail-expanded',
  'md-comp-navigation-rail-color',
  'md-comp-navigation-rail-horizontal-item'
]

// Whether items put their icon before their label, inside the pill.
const IconBeforeLabel = createContext(false)

export type NavigationBarProps = {
  'aria-label': string
  /**
   * Icons above labels, items sharing the width; or icons before labels,
   * items in the middle (for wider windows).
   */
  iconPosition?: 'top' | 'start'
  className?: string
  children?: ReactNode
}

/** An M3 navigation bar, for the foot of a narrow window: 3 to 5 items. */
export function NavigationBar({
  iconPosition = 'top',
  className,
  children,
  ...props
}: NavigationBarProps) {
  const start = iconPosition === 'start'
  return (
    <IconBeforeLabel.Provider value={start}>
      <nav
        className={cx(
          styles.bar,
          start && styles.centered,
          ...tokens,
          className
        )}
        style={{ '--_count': Children.count(children) } as CSSProperties}
        {...props}
      >
        {children}
      </nav>
    </IconBeforeLabel.Provider>
  )
}

export type NavigationRailProps = {
  'aria-label': string
  /** Expanded, items show their labels beside their icons. */
  expanded?: boolean
  /** Above the items, such as a menu button to expand it and a FAB. */
  header?: ReactNode
  className?: string
  children?: ReactNode
}

/** An M3 navigation rail, for the side of a wider window. */
export function NavigationRail({
  expanded = false,
  header,
  className,
  children,
  ...props
}: NavigationRailProps) {
  return (
    <IconBeforeLabel.Provider value={expanded}>
      <nav
        className={cx(
          styles.rail,
          expanded && styles.expanded,
          ...tokens,
          className
        )}
        {...props}
      >
        {header && <div className={styles.header}>{header}</div>}
        {children}
      </nav>
    </IconBeforeLabel.Provider>
  )
}

export type NavigationItemProps = {
  /** A Material Symbol's name, filled while selected, or any element. */
  icon: IconName | ReactElement
  label: ReactNode
  /** Marks it as current, if the router doesn't. */
  selected?: boolean
  /** Makes it a button, for navigation that isn't by link. */
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** A link, which gets the item's content. */
  children?: ReactElement
  className?: string
}

/**
 * An item in a NavigationBar or NavigationRail: its child link, or a
 * button with onClick, the current one marked with aria-current.
 */
export function NavigationItem({
  icon,
  label,
  selected,
  onClick,
  children,
  className
}: NavigationItemProps) {
  const start = useContext(IconBeforeLabel)
  const text = <span className={styles.label}>{label}</span>
  const content = (
    <>
      <span className={styles.pill}>
        <span className={styles.indicator} />
        {typeof icon === 'string' ? <Icon name={icon} /> : icon}
        {start && text}
        <StateLayer className={styles.layer} />
      </span>
      {!start && text}
    </>
  )
  const classes = cx(styles.item, start && styles.start, className)
  if (!children)
    return (
      <button
        type="button"
        className={classes}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
      >
        {content}
      </button>
    )
  return (
    <Slot.Root
      className={classes}
      {...(selected !== undefined && {
        'aria-current': selected ? 'page' : undefined
      })}
    >
      {content}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Slot.Root>
  )
}
