import { Dialog as Radix } from 'radix-ui'
import { useRef, type PointerEvent, type ReactNode } from 'react'
import styles from './bottom-sheet.module.css'
import { useReturnFocus } from './return-focus'
import './tokens/sheet-bottom.gen.css'
import './tokens/scrim.gen.css'

// BottomSheetDefaults' PositionalThreshold and VelocityThreshold: a drag
// down closes the sheet once it passes 56dp, or is let go faster than
// 125dp a second.
const closeDistance = 56
const closeSpeed = 125

export type BottomSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the sheet for screen readers; it isn't shown. */
  title: string
  /** A sentence about the sheet, read out when it opens; it isn't shown. */
  description?: string
  /** The handle to drag or press it closed by. On by default. */
  dragHandle?: boolean
  children?: ReactNode
}

/**
 * An M3 modal bottom sheet: modal, focus-trapped, closed with Escape, the
 * scrim, its handle, or a drag down from the top.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  dragHandle = true,
  children
}: BottomSheetProps) {
  const sheet = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    start: number
    moved: boolean
    samples: { y: number; t: number }[]
  }>(null)
  const dragged = useRef(false)
  const returnFocus = useReturnFocus()

  function settle() {
    const el = sheet.current
    if (!el) return
    el.classList.add(styles.settling!)
    el.style.setProperty('--_drag', '0px')
    el.addEventListener(
      'transitionend',
      () => el.classList.remove(styles.settling!),
      { once: true }
    )
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    drag.current = {
      start: e.clientY,
      moved: false,
      samples: [{ y: e.clientY, t: e.timeStamp }]
    }
    dragged.current = false
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = sheet.current
    if (!d || !el) return
    const dy = e.clientY - d.start
    if (!d.moved && Math.abs(dy) < 4) return
    if (!d.moved) {
      // Captured only once it's a drag, so a press still reaches the handle.
      e.currentTarget.setPointerCapture(e.pointerId)
      d.moved = true
      el.classList.remove(styles.settling!)
      el.classList.add(styles.dragging!)
    }
    // It doesn't go above where it opened.
    el.style.setProperty('--_drag', `${Math.max(0, dy)}px`)
    d.samples = [
      ...d.samples.filter((s) => e.timeStamp - s.t < 100),
      { y: e.clientY, t: e.timeStamp }
    ]
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    dragged.current = true
    sheet.current?.classList.remove(styles.dragging!)
    const first = d.samples[0]!
    const elapsed = e.timeStamp - first.t
    const speed = elapsed > 0 ? ((e.clientY - first.y) / elapsed) * 1000 : 0
    if (e.clientY - d.start > closeDistance || speed > closeSpeed)
      onOpenChange(false)
    else settle()
  }

  function cancel() {
    if (!drag.current?.moved) return
    drag.current = null
    sheet.current?.classList.remove(styles.dragging!)
    settle()
  }

  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className={`${styles.scrim} md-comp-scrim`} />
        <Radix.Content
          ref={sheet}
          className={`${styles.sheet} md-comp-sheet-bottom`}
          {...returnFocus}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <Radix.Title className={styles.title}>{title}</Radix.Title>
          {description && (
            <Radix.Description className={styles.title}>
              {description}
            </Radix.Description>
          )}
          {dragHandle && (
            <div
              className={styles.top}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={cancel}
            >
              <button
                type="button"
                className={styles.handle}
                aria-label="Close sheet"
                onClick={() => {
                  // A drag that ends on the handle isn't a press.
                  if (!dragged.current) onOpenChange(false)
                  dragged.current = false
                }}
              />
            </div>
          )}
          <div className={styles.content}>{children}</div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}
