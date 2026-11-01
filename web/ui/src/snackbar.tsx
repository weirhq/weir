import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Button } from './button'
import { IconButton } from './icon-button'
import styles from './snackbar.module.css'
import { Tooltip } from './tooltip'
import './tokens/snackbar.gen.css'

export type SnackbarProps = {
  message: ReactNode
  /** A text button's label, such as Undo. */
  actionLabel?: string
  onAction?: () => void
  /** Shows a close button that calls this. */
  onDismiss?: () => void
  /** Puts the action under the message, for a long action label. */
  actionOnNewLine?: boolean
  className?: string
}

/** An M3 snackbar on its own. Usually shown with useSnackbar instead. */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  actionOnNewLine = false,
  className
}: SnackbarProps) {
  const hasActions = actionLabel !== undefined || onDismiss !== undefined
  return (
    <div
      className={[
        styles.snackbar,
        actionOnNewLine && actionLabel && styles.newLine,
        'md-comp-snackbar',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.text}>{message}</div>
      {hasActions && (
        <div className={styles.actions}>
          {actionLabel !== undefined && (
            <Button variant="text" className={styles.action} onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {onDismiss && (
            // As Compose's close button, with its label as a tooltip.
            <Tooltip text="Dismiss">
              <IconButton
                icon="close"
                label="Dismiss"
                className={styles.dismiss}
                onClick={onDismiss}
              />
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}

export type SnackbarDuration = 'short' | 'long' | 'indefinite'

export type SnackbarOptions = {
  message: string
  actionLabel?: string
  withDismissAction?: boolean
  /**
   * Short (4s) without an action and indefinite with one, by default; long
   * is 10s. The time waits while the pointer or focus is on the snackbar.
   */
  duration?: SnackbarDuration
  actionOnNewLine?: boolean
}

/** Whether the snackbar's action was pressed, or it went away. */
export type SnackbarResult = 'action' | 'dismissed'

type Shown = SnackbarOptions & {
  id: number
  resolve: (result: SnackbarResult) => void
}

type Queue = {
  current: Shown | undefined
  show: (options: SnackbarOptions) => Promise<SnackbarResult>
  finish: (shown: Shown, result: SnackbarResult) => void
}

const SnackbarContext = createContext<Queue | null>(null)

/**
 * Holds the snackbars waiting to be shown, one at a time and in order, for
 * a SnackbarHost to show and useSnackbar to add to.
 */
export function SnackbarProvider({ children }: { children?: ReactNode }) {
  const [queue, setQueue] = useState<Shown[]>([])
  const next = useRef(0)
  const show = useCallback(
    (options: SnackbarOptions) =>
      new Promise<SnackbarResult>((resolve) => {
        const id = next.current++
        setQueue((q) => [...q, { ...options, id, resolve }])
      }),
    []
  )
  const finish = useCallback((shown: Shown, result: SnackbarResult) => {
    shown.resolve(result)
    setQueue((q) => q.filter((s) => s.id !== shown.id))
  }, [])
  return (
    <SnackbarContext.Provider value={{ current: queue[0], show, finish }}>
      {children}
    </SnackbarContext.Provider>
  )
}

/**
 * Returns a function that queues a snackbar and resolves when it's gone:
 * 'action' if its action was pressed, otherwise 'dismissed'.
 */
export function useSnackbar() {
  const queue = useContext(SnackbarContext)
  if (!queue) throw new Error('useSnackbar needs a SnackbarProvider')
  return queue.show
}

const millis: Record<Exclude<SnackbarDuration, 'indefinite'>, number> = {
  short: 4000,
  long: 10000
}

/**
 * Shows the provider's snackbars, at the foot of the window unless a class
 * places it elsewhere. Screen readers hear each one politely.
 */
export function SnackbarHost({ className }: { className?: string }) {
  const queue = useContext(SnackbarContext)
  if (!queue) throw new Error('SnackbarHost needs a SnackbarProvider')
  const { current, finish } = queue
  // Snackbars that have gone, still fading out.
  const [leaving, setLeaving] = useState<Shown[]>([])
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const held = hovered || focused
  const gone = useCallback(
    (id: number) => setLeaving((l) => l.filter((s) => s.id !== id)),
    []
  )

  const end = useCallback(
    (shown: Shown, result: SnackbarResult) => {
      setLeaving((l) => [...l, shown])
      // In case its fade never runs, as without animations.
      setTimeout(() => gone(shown.id), 1000)
      setHovered(false)
      setFocused(false)
      finish(shown, result)
    },
    [finish, gone]
  )

  const duration =
    current?.duration ?? (current?.actionLabel ? 'indefinite' : 'short')
  useEffect(() => {
    if (!current || duration === 'indefinite' || held) return
    const timer = setTimeout(() => end(current, 'dismissed'), millis[duration])
    return () => clearTimeout(timer)
  }, [current, duration, held, end])

  return (
    <div className={[styles.host, className].filter(Boolean).join(' ')}>
      {leaving.map((s) => (
        <div
          key={s.id}
          className={styles.item}
          data-state="closed"
          aria-hidden
          onAnimationEnd={(e) => {
            if (e.animationName.includes('fade-out')) gone(s.id)
          }}
        >
          <Snackbar
            message={s.message}
            actionLabel={s.actionLabel}
            actionOnNewLine={s.actionOnNewLine}
            onDismiss={s.withDismissAction ? () => {} : undefined}
          />
        </div>
      ))}
      {/* Only the current snackbar is in the live region. */}
      <div role="status" className={styles.live}>
        {current && (
          <div
            key={current.id}
            className={styles.item}
            data-state="open"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                setFocused(false)
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Escape') end(current, 'dismissed')
            }}
          >
            <Snackbar
              message={current.message}
              actionLabel={current.actionLabel}
              onAction={() => end(current, 'action')}
              onDismiss={
                current.withDismissAction
                  ? () => end(current, 'dismissed')
                  : undefined
              }
              actionOnNewLine={current.actionOnNewLine}
            />
          </div>
        )}
      </div>
    </div>
  )
}
