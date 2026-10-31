import {
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type PointerEvent
} from 'react'
import styles from './slider.module.css'
import './tokens/slider.gen.css'

export type SliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step'
> & {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  /** Makes the slider discrete, with a stop at each step. */
  step?: number
  /** Text for a value, shown above the handle while it's held or focused. */
  valueLabel?: (value: number) => string
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

/**
 * An M3 Expressive slider, a native range input underneath for keyboards,
 * forms and assistive technology. Give it an aria-label or aria-labelledby.
 */
export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step,
  valueLabel,
  disabled,
  className,
  style,
  ...props
}: SliderProps) {
  const rail = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const span = max - min || 1
  const f = clamp((value - min) / span, 0, 1)
  const steps = step ? Math.round(span / step) : 0
  const stops = steps
    ? Array.from({ length: steps + 1 }, (_, i) => i / steps)
    : []
  // SliderImpl: with steps, positions other than the first and last are
  // inset by the track's corner radius.
  const inset = steps > 0 && f > 0 && f < 1

  // The value under the pointer, by the same placement the handle uses.
  const valueAt = (clientX: number) => {
    const box = rail.current!.getBoundingClientRect()
    const x = clientX - box.left
    if (!steps) return min + clamp(x / box.width, 0, 1) * span
    // Half the track's height, as in the CSS.
    const corner =
      parseFloat(
        getComputedStyle(rail.current!).getPropertyValue(
          '--md-comp-slider-inactive-track-height'
        )
      ) / 2 || 0
    const at = (t: number) =>
      t === 0 || t === 1 ? t * box.width : corner + t * (box.width - 2 * corner)
    const nearest = stops.reduce((best, t) =>
      Math.abs(at(t) - x) < Math.abs(at(best) - x) ? t : best
    )
    return min + nearest * span
  }

  const press = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    input.current?.focus({ preventScroll: true })
    onValueChange(valueAt(e.clientX))
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onValueChange(valueAt(e.clientX))
  }
  const release = () => setDragging(false)

  return (
    <div
      className={[
        styles.slider,
        dragging && styles.dragging,
        inset && styles.inset,
        'md-comp-slider',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ...style, '--_f': f } as CSSProperties}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <input
        ref={input}
        type="range"
        className={styles.input}
        min={min}
        max={max}
        step={step ?? 'any'}
        value={value}
        disabled={disabled}
        aria-valuetext={valueLabel?.(value)}
        onChange={(e) => onValueChange(Number(e.target.value))}
        {...props}
      />
      <div ref={rail} className={styles.rail} aria-hidden>
        <div className={`${styles.track} ${styles.active}`}>
          {stops.map((t) => (
            <span
              key={t}
              className={styles.stop}
              style={{ '--_t': t } as CSSProperties}
            />
          ))}
        </div>
        <div className={`${styles.track} ${styles.inactive}`}>
          {/* The end stop, which Compose draws without steps too. */}
          {(stops.length ? stops : [1]).map((t) => (
            <span
              key={t}
              className={styles.stop}
              style={{ '--_t': t } as CSSProperties}
            />
          ))}
        </div>
        <div className={styles.handle} />
        {valueLabel && <div className={styles.label}>{valueLabel(value)}</div>}
      </div>
    </div>
  )
}
