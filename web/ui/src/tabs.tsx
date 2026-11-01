import { Slot, Tabs as Radix } from 'radix-ui'
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import { StateLayer } from './state-layer'
import styles from './tabs.module.css'
import './tokens/primary-navigation-tab.gen.css'
import './tokens/secondary-navigation-tab.gen.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

type RowProps = {
  /** Primary tabs sit under an app bar; secondary ones within content. */
  variant?: 'primary' | 'secondary'
  /** Tabs keep their own widths and the row scrolls, for many tabs. */
  scrollable?: boolean
  'aria-label'?: string
  className?: string
  children?: ReactNode
}

function rowClasses({ variant = 'primary', scrollable, className }: RowProps) {
  return cx(
    styles.row,
    styles[variant],
    scrollable && styles.scrollable,
    `md-comp-${variant}-navigation-tab`,
    // Secondary tabs take the primary indicator and label tokens, as
    // Compose's do.
    variant === 'secondary' && 'md-comp-primary-navigation-tab',
    className
  )
}

/**
 * Slides the row's indicator to its selected tab: under the tab's content
 * for primary tabs (at least 24dp), across the whole tab for secondary.
 * It follows the selection and sizes as they change, and a scrollable row
 * brings a newly selected tab into view.
 */
function useIndicator(variant: RowProps['variant'], scrollable?: boolean) {
  const row = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    let selected: Element | null = null
    const sizes = new ResizeObserver(() => place())
    const watch = () => {
      sizes.disconnect()
      sizes.observe(el)
      for (const c of el.querySelectorAll(`.${styles.content}`))
        sizes.observe(c)
    }
    const place = () => {
      const tab = el.querySelector<HTMLElement>(
        ':scope > [data-state="active"], :scope > [aria-current="page"]'
      )
      if (tab !== selected) {
        if (scrollable && selected)
          tab?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
        selected = tab
      }
      if (!tab) {
        el.style.setProperty('--_w', '0px')
        return
      }
      const box = el.getBoundingClientRect()
      const t = tab.getBoundingClientRect()
      let x = t.left - box.left + el.scrollLeft
      let w = t.width
      if (variant !== 'secondary') {
        const c = tab.querySelector(`.${styles.content}`)
        const cw = Math.max(c?.getBoundingClientRect().width ?? 0, 24)
        x += (w - cw) / 2
        w = cw
      }
      el.style.setProperty('--_x', `${x}px`)
      el.style.setProperty('--_w', `${w}px`)
    }
    // Radix and routers mark the selected tab without rendering the row.
    const changes = new MutationObserver(() => {
      watch()
      place()
    })
    changes.observe(el, {
      subtree: true,
      childList: true,
      attributeFilter: ['data-state', 'aria-current']
    })
    watch()
    place()
    // Slide only once it's in place, not from the start on first show.
    const frame = requestAnimationFrame(() => el.classList.add(styles.moving!))
    return () => {
      cancelAnimationFrame(frame)
      sizes.disconnect()
      changes.disconnect()
    }
  }, [variant, scrollable])
  return row
}

type ContentProps = {
  /** A Material Symbol's name, or any element. */
  icon?: IconName | ReactElement
  /** Above the label (Tab), or before it (LeadingIconTab). */
  iconPosition?: 'top' | 'leading'
}

function tabClasses(
  { icon, iconPosition = 'top' }: ContentProps,
  label: ReactNode,
  className?: string
) {
  const both = !!icon && !!label
  return cx(
    styles.tab,
    both && iconPosition === 'top' && styles.stacked,
    both && iconPosition === 'leading' && styles.leading,
    className
  )
}

function Content({ icon, label }: ContentProps & { label: ReactNode }) {
  return (
    <span className={styles.content}>
      {icon && (typeof icon === 'string' ? <Icon name={icon} /> : icon)}
      {label && <span>{label}</span>}
    </span>
  )
}

/** Tabs that switch between panels in the page. Holds the selected value. */
export function Tabs(props: ComponentProps<typeof Radix.Root>) {
  return <Radix.Root {...props} />
}

export type TabListProps = RowProps

/** The row of Tabs, with arrow keys moving between them. */
export function TabList({ variant, scrollable, ...props }: TabListProps) {
  const row = useIndicator(variant, scrollable)
  return (
    <Radix.List
      ref={row as Ref<HTMLDivElement>}
      className={rowClasses({ variant, scrollable, ...props })}
      aria-label={props['aria-label']}
    >
      {props.children}
      <span className={styles.indicator} aria-hidden />
    </Radix.List>
  )
}

export type TabProps = ContentProps & {
  value: string
  children?: ReactNode
  disabled?: boolean
  /** Needed when there's only an icon. */
  'aria-label'?: string
  className?: string
}

/** One tab in a TabList, for the TabPanel with the same value. */
export function Tab({
  value,
  icon,
  iconPosition,
  children,
  disabled,
  className,
  ...props
}: TabProps) {
  return (
    <Radix.Trigger
      value={value}
      disabled={disabled}
      className={tabClasses({ icon, iconPosition }, children, className)}
      {...props}
    >
      <Content icon={icon} label={children} />
      <StateLayer className={styles.layer} />
    </Radix.Trigger>
  )
}

/** The content for one Tab, shown while it's selected. */
export function TabPanel(props: ComponentProps<typeof Radix.Content>) {
  return <Radix.Content {...props} />
}

export type TabNavProps = RowProps

/**
 * Tabs that move between pages: a nav of TabLinks, the current one marked
 * aria-current="page" (by the router, or with selected).
 */
export function TabNav({ variant, scrollable, ...props }: TabNavProps) {
  const row = useIndicator(variant, scrollable)
  return (
    <nav
      ref={row}
      className={rowClasses({ variant, scrollable, ...props })}
      aria-label={props['aria-label']}
    >
      {props.children}
      <span className={styles.indicator} aria-hidden />
    </nav>
  )
}

export type TabLinkProps = ContentProps & {
  label?: ReactNode
  /** Marks it as the current page, if the router doesn't. */
  selected?: boolean
  /** The link, which gets the tab's content. */
  children: ReactElement
  className?: string
}

/** One tab in a TabNav: its child link with the tab's content. */
export function TabLink({
  label,
  icon,
  iconPosition,
  selected,
  children,
  className
}: TabLinkProps) {
  return (
    <Slot.Root
      className={tabClasses({ icon, iconPosition }, label, className)}
      {...(selected !== undefined && {
        'aria-current': selected ? 'page' : undefined
      })}
    >
      <Content icon={icon} label={label} />
      <StateLayer className={styles.layer} />
      <Slot.Slottable>{children}</Slot.Slottable>
    </Slot.Root>
  )
}
