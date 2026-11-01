import { useEffect, useRef } from 'react'
import styles from './state-layer.module.css'

/** Add to an interactive element's classes for M3's focus outline. */
export const focusRing = styles.focusRing!

/**
 * The hover, focus and press feedback for an interactive element. Render it
 * as a child of the element, which needs position: relative.
 */
export function StateLayer({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const layer = ref.current
    const host = layer?.parentElement
    if (!layer || !host) return
    const press = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        host.matches(':disabled, [aria-disabled="true"]') ||
        host.querySelector(':scope > input:disabled')
      )
        return
      // A circle from the pointer that reaches the farthest corner.
      const box = host.getBoundingClientRect()
      const x = e.clientX - box.left
      const y = e.clientY - box.top
      const r = Math.hypot(
        Math.max(x, box.width - x),
        Math.max(y, box.height - y)
      )
      const ripple = document.createElement('span')
      ripple.className = styles.ripple!
      Object.assign(ripple.style, {
        left: `${x - r}px`,
        top: `${y - r}px`,
        width: `${2 * r}px`,
        height: `${2 * r}px`
      })
      layer.append(ripple)
      const release = () => {
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', release)
        ripple.classList.add(styles.released!)
        setTimeout(() => ripple.remove(), 500)
      }
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', release)
    }
    host.addEventListener('pointerdown', press)
    return () => host.removeEventListener('pointerdown', press)
  }, [])

  return (
    <span
      ref={ref}
      aria-hidden
      className={className ? `${styles.layer} ${className}` : styles.layer}
    />
  )
}
