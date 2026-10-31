import { useEffect, useRef, type HTMLAttributes, type RefObject } from 'react'
import styles from './button-group.module.css'
import './tokens/button-group-small.gen.css'
import './tokens/connected-button-group-small.gen.css'

export type ButtonGroupProps = HTMLAttributes<HTMLDivElement> & {
  /** Names the group for assistive technology. */
  label?: string
}

// ButtonGroupDefaults.ExpandedRatio: a pressed item widens by this much of
// its width, taken from its neighbours.
const expandedRatio = 0.15
// ButtonDefaults.ContentPadding's end: how far a neighbour can shrink when
// it has no padding of its own (icon buttons).
const defaultCompression = 24

/**
 * Widens the item pressed in a group and narrows its neighbours to make
 * room, as Compose's ButtonGroup does, then springs back on release.
 */
function useEnlargeOnPress(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const group = ref.current
    if (!group) return
    const press = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      )
        return
      const items = [...group.children] as HTMLElement[]
      const index = items.findIndex((item) => item.contains(e.target as Node))
      const item = items[index]
      if (
        !item ||
        items.length < 2 ||
        typeof item.animate !== 'function' ||
        item.matches(':disabled, [aria-disabled="true"]')
      )
        return
      const from = items.map((i) => i.getBoundingClientRect().width)
      const limit = (i: number) =>
        parseFloat(getComputedStyle(items[i]!).paddingInlineEnd) ||
        defaultCompression
      // A middle item grows into both neighbours by the same amount, an end
      // item into its one neighbour.
      const neighbours = [index - 1, index + 1].filter((i) => items[i])
      const growth = Math.min(
        (expandedRatio * from[index]!) / neighbours.length,
        ...neighbours.map(limit)
      )
      const to = [...from]
      for (const n of neighbours) {
        const g = Math.min(growth, from[n]!)
        to[n] = from[n]! - g
        to[index] = to[index]! + g
      }

      const root = getComputedStyle(group)
      const easing = root
        .getPropertyValue('--md-sys-motion-spring-fast-spatial')
        .trim()
      const duration = parseFloat(
        root.getPropertyValue('--md-sys-motion-spring-fast-spatial-duration')
      )
      const animate = (widths: number[], back: number[]) =>
        items.map((el, i) =>
          widths[i] === back[i]
            ? undefined
            : // Compose sizes group items exactly, past their minimum width.
              el.animate(
                [
                  { width: `${back[i]}px`, minWidth: '0px' },
                  { width: `${widths[i]}px`, minWidth: '0px' }
                ],
                { duration, easing, fill: 'forwards' }
              )
        )
      let running = animate(to, from)
      const release = () => {
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', release)
        const now = items.map((el) => el.getBoundingClientRect().width)
        running.forEach((a) => a?.cancel())
        running = animate(from, now)
        Promise.all(running.map((a) => a?.finished)).then(
          () => running.forEach((a) => a?.cancel()),
          () => {}
        )
      }
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', release)
    }
    group.addEventListener('pointerdown', press)
    return () => group.removeEventListener('pointerdown', press)
  }, [ref])
}

function Group({
  label,
  connected,
  className,
  ...props
}: ButtonGroupProps & { connected: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEnlargeOnPress(ref)
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={[
        styles.group,
        connected && styles.connected,
        connected
          ? 'md-comp-connected-button-group-small'
          : 'md-comp-button-group-small',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}

/**
 * Buttons and icon buttons side by side. Pressing one widens it briefly,
 * at its neighbours' expense.
 */
export function ButtonGroup(props: ButtonGroupProps) {
  return <Group {...props} connected={false} />
}

/**
 * Buttons joined into one control, typically toggles for choosing among
 * options: the ends are round, the joins small, and a selected button
 * rounds fully.
 */
export function ConnectedButtonGroup(props: ButtonGroupProps) {
  return <Group {...props} connected />
}
