import { useEffect, useRef, type ReactNode } from 'react'
import styles from './app-bar.module.css'
import './tokens/app-bar.gen.css'
import './tokens/app-bar-small.gen.css'
import './tokens/app-bar-medium-flexible.gen.css'
import './tokens/app-bar-large-flexible.gen.css'
import './tokens/bottom-app-bar.gen.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export type TopAppBarScrollBehavior =
  'pinned' | 'enterAlways' | 'exitUntilCollapsed'

export type TopAppBarProps = {
  title: ReactNode
  subtitle?: ReactNode
  /** Usually an icon button, at the start. */
  navigationIcon?: ReactNode
  /** Usually icon buttons, at the end. */
  actions?: ReactNode
  /** Small is one 64dp row; medium and large add a row for a bigger title. */
  size?: 'small' | 'medium' | 'large'
  align?: 'start' | 'center'
  /**
   * Pinned stays put and takes the on-scroll colour once content is under
   * it; enterAlways moves away as the page scrolls down and back as it
   * scrolls up; exitUntilCollapsed (medium and large) shrinks to the top
   * row. Without one, the bar stays where it's placed.
   */
  scrollBehavior?: TopAppBarScrollBehavior
  /** The element whose scrolling it follows; the window by default. */
  scrollTarget?: HTMLElement | null
  /** Makes the title a heading of this level. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  className?: string
}

// TopTitleAlphaEasing, CubicBezierEasing(0.8, 0, 0.8, 0.15).
function topTitleAlpha(x: number) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const [x1, y1, x2, y2] = [0.8, 0, 0.8, 0.15]
  const at = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (at(mid, x1, x2) < x) lo = mid
    else hi = mid
  }
  return at((lo + hi) / 2, y1, y2)
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

/** Follows the page's scrolling, as Compose's TopAppBarScrollBehaviors do. */
function useScrollBehavior(
  behavior: TopAppBarScrollBehavior | undefined,
  twoRows: boolean,
  target: HTMLElement | null | undefined
) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const bar = ref.current
    if (!bar || !behavior) return
    const source: HTMLElement | Window = target ?? window
    const scrollTop = () => (target ? target.scrollTop : window.scrollY)
    const row = bar.firstElementChild as HTMLElement
    const [small, big] = bar.querySelectorAll<HTMLElement>('[data-title]')
    let last = scrollTop()
    let offset = 0
    let fraction = 0
    let idle: ReturnType<typeof setTimeout> | undefined

    const settle = () => {
      if (behavior === 'enterAlways') {
        const h = bar.offsetHeight
        if (offset > 0 && offset < h) {
          bar.classList.add(styles.settling!)
          offset = offset < h / 2 ? 0 : h
          bar.style.setProperty('--_offset', `${offset}px`)
        }
      } else if (behavior === 'exitUntilCollapsed' && twoRows) {
        // Like Compose's snap: a half-collapsed bar finishes one way.
        if (fraction > 0 && fraction < 1)
          source.scrollTo({
            top: fraction < 0.5 ? 0 : bar.offsetHeight - row.offsetHeight,
            behavior: 'smooth'
          })
      }
    }

    const update = () => {
      const y = scrollTop()
      if (behavior === 'exitUntilCollapsed' && twoRows) {
        const range = bar.offsetHeight - row.offsetHeight
        fraction = range > 0 ? clamp(y / range) : 0
        bar.style.setProperty('--_collapsed', `${fraction}`)
        bar.style.setProperty('--_top-title', `${topTitleAlpha(fraction)}`)
        // Only the title that's showing is read out.
        small?.setAttribute('aria-hidden', `${fraction < 0.5}`)
        big?.setAttribute('aria-hidden', `${fraction >= 0.5}`)
      } else {
        bar.classList.toggle(styles.scrolled!, !twoRows && y > 0)
      }
      if (behavior === 'enterAlways') {
        bar.classList.remove(styles.settling!)
        offset = Math.min(bar.offsetHeight, Math.max(0, offset + y - last))
        bar.style.setProperty('--_offset', `${offset}px`)
      }
      last = y
      clearTimeout(idle)
      idle = setTimeout(settle, 150)
    }

    update()
    source.addEventListener('scroll', update, { passive: true })
    return () => {
      clearTimeout(idle)
      source.removeEventListener('scroll', update)
    }
  }, [behavior, twoRows, target])
  return ref
}

/** An M3 top app bar: a title, with navigation at the start and actions at the end. */
export function TopAppBar({
  title,
  subtitle,
  navigationIcon,
  actions,
  size = 'small',
  align = 'start',
  scrollBehavior,
  scrollTarget,
  headingLevel,
  className
}: TopAppBarProps) {
  const twoRows = size !== 'small'
  const ref = useScrollBehavior(scrollBehavior, twoRows, scrollTarget)
  const Heading = headingLevel ? (`h${headingLevel}` as const) : 'div'
  const titleText = (
    <>
      <Heading className={styles.headline}>{title}</Heading>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
    </>
  )
  return (
    <header
      ref={ref}
      className={cx(
        styles.bar,
        twoRows && styles[size],
        align === 'center' && styles.center,
        !!subtitle && styles.withSubtitle,
        scrollBehavior &&
          (scrollBehavior === 'exitUntilCollapsed' && twoRows
            ? styles.collapsing
            : styles.sticky),
        scrollBehavior === 'enterAlways' && styles.entering,
        'md-comp-app-bar',
        'md-comp-app-bar-small',
        size === 'medium' && 'md-comp-app-bar-medium-flexible',
        size === 'large' && 'md-comp-app-bar-large-flexible',
        className
      )}
    >
      <div className={styles.row}>
        {navigationIcon && (
          <div className={styles.navigation}>{navigationIcon}</div>
        )}
        <div
          className={styles.title}
          data-title
          // The big title speaks for a bar that hasn't collapsed.
          aria-hidden={twoRows || undefined}
        >
          {titleText}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {twoRows && (
        <div className={styles.expanded} data-title>
          {titleText}
        </div>
      )}
    </header>
  )
}

export type BottomAppBarProps = {
  /** Usually up to four icon buttons. */
  actions?: ReactNode
  /** A FAB at the end. */
  fab?: ReactNode
  'aria-label'?: string
  className?: string
}

/** An M3 bottom app bar: actions for the screen, and maybe a FAB. */
export function BottomAppBar({
  actions,
  fab,
  className,
  ...props
}: BottomAppBarProps) {
  return (
    <div
      className={cx(
        styles.bottom,
        'md-comp-bottom-app-bar',
        'md-comp-app-bar',
        className
      )}
      {...props}
    >
      <div className={styles.bottomActions}>{actions}</div>
      {fab && <div className={styles.fab}>{fab}</div>}
    </div>
  )
}
