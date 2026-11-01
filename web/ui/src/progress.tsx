import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import styles from './progress.module.css'
import './tokens/progress-indicator.gen.css'
import './tokens/linear-progress-indicator.gen.css'
import './tokens/circular-progress-indicator.gen.css'

// The drawing follows Compose's ProgressIndicator.kt, WavyProgressIndicator.kt
// and the wavy modifiers in internal/ at the pinned commit; numbers come from
// there or from the component tokens, read from the stylesheet.

type Point = [number, number]

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (at(mid, x1, x2) < x) lo = mid
      else hi = mid
    }
    return at((lo + hi) / 2, y1, y2)
  }
}

const linear = (x: number) => x
const emphasizedAccelerate = cubicBezier(0.3, 0, 0.8, 0.15)
const standard = cubicBezier(0.2, 0, 0, 1)

/**
 * A Compose keyframes spec: [time, value, easing] where, as in Compose, a
 * keyframe's easing runs from it to the next. Before the first keyframe
 * the value runs linearly from `from`.
 */
function keyframes(
  duration: number,
  from: number,
  frames: [number, number, ((x: number) => number)?][]
) {
  const all: [number, number, (x: number) => number][] = [
    [0, from, linear],
    ...frames.map(
      ([t, v, e]) =>
        [t, v, e ?? linear] as [number, number, (x: number) => number]
    )
  ]
  return (ms: number) => {
    const t = ms % duration
    for (let i = all.length - 1; i >= 0; i--) {
      const [t0, v0, ease] = all[i]!
      if (t < t0) continue
      const next = all[i + 1]
      if (!next) return v0
      const [t1, v1] = next
      return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0))
    }
    return from
  }
}

// Linear indeterminate: two lines, heads and tails eased in turn (1750ms).
const line = (delay: number, length: number) =>
  keyframes(1750, 0, [
    [delay, 0, emphasizedAccelerate],
    [delay + length, 1]
  ])
const firstHead = line(0, 1000)
const firstTail = line(250, 1000)
const secondHead = line(650, 850)
const secondTail = line(900, 850)

// Circular indeterminate (6000ms): a steady 1080° turn, four quick 90°
// turns, and a sweep between 10% and 87%. Compose puts EmphasizedDecelerate
// on the keyframe each quick turn ends at, which governs the hold after it,
// so the turns themselves run linearly, as here.
const globalRotation = (ms: number) => ((ms % 6000) / 6000) * 1080
const additionalRotation = keyframes(6000, 0, [
  [300, 90],
  [1500, 90],
  [1800, 180],
  [3000, 180],
  [3300, 270],
  [4500, 270],
  [4800, 360],
  [6000, 360]
])
const circularSweep = keyframes(6000, 0.1, [
  [3000, 0.87, standard],
  [6000, 0.1]
])

// Wavy indicators flatten near the ends: no wave at or below 10% or at or
// above 95% (WavyProgressIndicatorDefaults.indicatorAmplitude), changing
// over 500ms, Standard as it grows and EmphasizedAccelerate as it goes.
const targetAmplitude = (p: number) => (p <= 0.1 || p >= 0.95 ? 0 : 1)

type Colors = { active: string; track: string; stop: string }

function readColors(el: Element): Colors {
  const s = getComputedStyle(el)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return {
    active: v('--md-comp-progress-indicator-active-indicator-color'),
    track: v('--md-comp-progress-indicator-track-color'),
    stop: v('--md-comp-progress-indicator-stop-color')
  }
}

type Draw = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: Colors,
  now: number,
  progress: number | undefined,
  amplitude: number
) => void

/**
 * Runs a canvas: sized to its box at the device's pixel ratio, redrawn
 * each frame while it animates and when the theme changes. A new value is
 * eased to (500ms, linear), as Compose's ProgressAnimationSpec suggests.
 */
function useIndicatorCanvas(
  value: number | undefined,
  wavy: boolean,
  draw: Draw
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef({
    shown: value,
    from: value,
    target: value,
    since: 0,
    amplitude: value === undefined ? 1 : targetAmplitude(value),
    ampFrom: 0,
    ampTarget: 0,
    ampSince: 0
  })
  const drawRef = useRef(draw)
  useLayoutEffect(() => {
    drawRef.current = draw
  })

  useEffect(() => {
    const s = state.current
    const now = performance.now()
    if (value === undefined || s.shown === undefined) {
      s.shown = s.from = s.target = value
    } else if (value !== s.target) {
      s.from = s.shown
      s.target = value
      s.since = now
    }
  }, [value])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let colors = readColors(canvas)
    let frame = 0
    const paint = (now: number) => {
      const s = state.current
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr))
        canvas.width = Math.round(w * dpr)
      if (canvas.height !== Math.round(h * dpr))
        canvas.height = Math.round(h * dpr)
      // Ease to a new value.
      let moving = false
      if (s.target !== undefined && s.from !== undefined) {
        const t = Math.min(1, (now - s.since) / 500)
        s.shown = s.from + (s.target - s.from) * t
        moving = t < 1
      }
      // Grow or flatten the wave.
      if (wavy) {
        const want = s.shown === undefined ? 1 : targetAmplitude(s.shown)
        if (want !== s.ampTarget) {
          s.ampFrom = s.amplitude
          s.ampTarget = want
          s.ampSince = now
        }
        const t = Math.min(1, (now - s.ampSince) / 500)
        const ease = s.ampTarget > s.ampFrom ? standard : emphasizedAccelerate
        s.amplitude = s.ampFrom + (s.ampTarget - s.ampFrom) * ease(t)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      drawRef.current(ctx, w, h, colors, now, s.shown, wavy ? s.amplitude : 0)
      // Keep going while something moves: indeterminate, a wave, a change.
      if (
        s.shown === undefined ||
        moving ||
        (wavy && s.amplitude > 0) ||
        (wavy && s.amplitude !== s.ampTarget)
      )
        frame = requestAnimationFrame(paint)
      else frame = 0
    }
    const again = () => {
      colors = readColors(canvas)
      if (!frame) frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    // The theme can change under it: the page's data-theme, or the system.
    const themes = new MutationObserver(again)
    themes.observe(document.documentElement, { attributes: true })
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)')
    scheme?.addEventListener('change', again)
    const sizes = new ResizeObserver(again)
    sizes.observe(canvas)
    return () => {
      cancelAnimationFrame(frame)
      themes.disconnect()
      scheme?.removeEventListener('change', again)
      sizes.disconnect()
    }
  }, [value, wavy])
  return ref
}

function stroke(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  points: Point[]
) {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(...points[0]!)
  for (const p of points.slice(1)) ctx.lineTo(...p)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}

const px = (el: CanvasRenderingContext2D, name: string) =>
  parseFloat(getComputedStyle(el.canvas).getPropertyValue(name)) || 0

export type ProgressIndicatorProps = {
  /** From 0 to 1; leave it out while there's no telling how long. */
  value?: number
  /** M3 Expressive's wavy indicator. */
  wavy?: boolean
  'aria-label'?: string
  className?: string
  style?: CSSProperties
}

function aria(value: number | undefined, label: string | undefined) {
  return {
    role: 'progressbar',
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow':
      value === undefined
        ? undefined
        : Math.round(Math.min(1, Math.max(0, value)) * 100)
  } as const
}

/** An M3 linear progress indicator, flat or wavy, as wide as its box. */
export function LinearProgressIndicator({
  value,
  wavy = false,
  className,
  style,
  ...props
}: ProgressIndicatorProps) {
  const clamped =
    value === undefined ? undefined : Math.min(1, Math.max(0, value))
  const ref = useIndicatorCanvas(clamped, wavy, (ctx, w, h, c, now, p, amp) => {
    const thickness = px(
      ctx,
      '--md-comp-linear-progress-indicator-active-thickness'
    )
    const gap = px(
      ctx,
      '--md-comp-linear-progress-indicator-track-active-space'
    )
    const stopSize = px(ctx, '--md-comp-linear-progress-indicator-stop-size')
    const wavelength = px(
      ctx,
      p === undefined
        ? '--md-comp-linear-progress-indicator-indeterminate-active-wave-wavelength'
        : '--md-comp-linear-progress-indicator-active-wave-wavelength'
    )
    const cap = thickness / 2
    const mid = h / 2
    const peak = (h - thickness) / 2
    // One wavelength a second, moving towards the start.
    const shift = ((now / 1000) % 1) * wavelength
    const at = (x: number): Point => [
      x,
      amp > 0
        ? mid + amp * peak * Math.sin((2 * Math.PI * (x + shift)) / wavelength)
        : mid
    ]
    const segment = (from: number, to: number): Point[] => {
      const a = Math.min(Math.max(from, cap), w - cap)
      const b = Math.min(Math.max(to, cap), w - cap)
      const points: Point[] = []
      for (let x = a; x < b; x += 1) points.push(at(x))
      points.push(at(b))
      return points
    }
    // Segments of active indicator, as fractions, and the track between.
    const parts: [number, number][] =
      p === undefined
        ? [
            [firstTail(now), firstHead(now)],
            [secondTail(now), secondHead(now)]
          ]
        : [[0, p]]
    // Track, right to left, stopping a gap (plus the caps) short of each part.
    let end = w - cap
    for (const [tail, head] of parts) {
      const headX = head * w
      const tailX = tail * w
      if (head - tail <= 0) continue
      const visible = headX >= cap
      const space = visible
        ? Math.min(Math.max(headX - cap, 0), gap) + cap * 2
        : 0
      if (end > Math.max(headX, cap) + space)
        stroke(ctx, c.track, thickness, [
          [end, mid],
          [Math.max(cap, headX + space), mid]
        ])
      end = Math.max(cap, tailX - space)
    }
    if (end > cap)
      stroke(ctx, c.track, thickness, [
        [end, mid],
        [cap, mid]
      ])
    for (const [tail, head] of parts)
      if (head - tail > 0)
        stroke(ctx, c.active, thickness, segment(tail * w, head * w))
    // The stop at the end of a determinate track, inset within taller boxes.
    if (p !== undefined) {
      const size = Math.min(stopSize, h)
      const inset = Math.min((h - size) / 2, 6)
      ctx.beginPath()
      ctx.arc(w - size / 2 - inset, mid, size / 2, 0, 2 * Math.PI)
      ctx.fillStyle = c.stop
      ctx.fill()
    }
  })
  return (
    <canvas
      ref={ref}
      className={[
        styles.linear,
        wavy && styles.wavy,
        'md-comp-progress-indicator',
        'md-comp-linear-progress-indicator',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      {...aria(clamped, props['aria-label'])}
    />
  )
}

/** An M3 circular progress indicator, flat (40dp) or wavy (48dp). */
export function CircularProgressIndicator({
  value,
  wavy = false,
  className,
  style,
  ...props
}: ProgressIndicatorProps) {
  const clamped =
    value === undefined ? undefined : Math.min(1, Math.max(0, value))
  const ref = useIndicatorCanvas(clamped, wavy, (ctx, w, h, c, now, p, amp) => {
    const thickness = px(
      ctx,
      '--md-comp-circular-progress-indicator-active-thickness'
    )
    const gap = px(
      ctx,
      '--md-comp-circular-progress-indicator-track-active-space'
    )
    const wavelength = px(
      ctx,
      '--md-comp-circular-progress-indicator-active-wave-wavelength'
    )
    const amplitude = px(
      ctx,
      '--md-comp-circular-progress-indicator-active-wave-amplitude'
    )
    const size = Math.min(w, h)
    const r = size / 2 - thickness / 2
    const cx = w / 2
    const cy = h / 2
    // One wave each wavelength round, turning one wavelength a second.
    const waves = Math.max(3, Math.round((2 * Math.PI * r) / wavelength))
    const turn = (((now / 1000) * wavelength) / r) % (2 * Math.PI)
    const radius = (a: number) =>
      amp > 0
        ? r - amplitude * amp + amplitude * amp * Math.cos(waves * (a - turn))
        : r
    const arc = (start: number, sweep: number): Point[] => {
      const points: Point[] = []
      const steps = Math.max(2, Math.ceil((Math.abs(sweep) * r) / 1.5))
      for (let i = 0; i <= steps; i++) {
        const a = start + (sweep * i) / steps
        const rr = radius(a)
        points.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
      }
      return points
    }
    const rad = (deg: number) => (deg * Math.PI) / 180
    // Start at 12 o'clock, or wherever the indeterminate turns have got to.
    const start =
      p === undefined ? globalRotation(now) + additionalRotation(now) : 270
    const sweep = (p ?? circularSweep(now)) * 360
    // The gap, plus the caps, as an angle.
    const gapSweep = ((gap + thickness) / (Math.PI * size)) * 360
    const trackStart = start + sweep + Math.min(sweep, gapSweep)
    const trackSweep = 360 - sweep - Math.min(sweep, gapSweep) * 2
    // A determinate indicator shows its track; an indeterminate one doesn't.
    if (p !== undefined && trackSweep > 0) {
      ctx.beginPath()
      ctx.arc(cx, cy, r, rad(trackStart), rad(trackStart + trackSweep))
      ctx.strokeStyle = c.track
      ctx.lineWidth = thickness
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    stroke(ctx, c.active, thickness, arc(rad(start), rad(Math.max(sweep, 0.1))))
  })
  return (
    <canvas
      ref={ref}
      className={[
        styles.circular,
        wavy && styles.wavy,
        'md-comp-progress-indicator',
        'md-comp-circular-progress-indicator',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      {...aria(clamped, props['aria-label'])}
    />
  )
}
