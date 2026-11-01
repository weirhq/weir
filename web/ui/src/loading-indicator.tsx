import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import styles from './loading-indicator.module.css'
import { MaterialShapes } from './material-shapes'
import { Morph, toPath2D, type Cubic, type RoundedPolygon } from './shapes'
import './tokens/loading-indicator.gen.css'

// Following Compose's LoadingIndicator.kt at the pinned commit.

const morphSequence = (polygons: RoundedPolygon[], circular: boolean) =>
  polygons.flatMap((p, i) => {
    const next = polygons[i + 1] ?? (circular ? polygons[0] : undefined)
    return next ? [new Morph(p.normalized(), next.normalized())] : []
  })

// The scale that keeps every shape inside the box whichever way it turns.
function scaleFactor(polygons: RoundedPolygon[]) {
  let scale = 1
  for (const p of polygons) {
    const [l, t, r, b] = p.calculateBounds()
    const [ml, mt, mr, mb] = p.calculateMaxBounds()
    scale = Math.min(
      scale,
      Math.max((r! - l!) / (mr! - ml!), (b! - t!) / (mb! - mt!))
    )
  }
  return scale
}

type Set = { morphs: Morph[]; scale: number }
let indeterminate: Set | undefined
let determinate: Set | undefined

// LoadingIndicatorDefaults: seven shapes in a loop; or, for progress, a
// circle (turned to line up with the burst) to a soft burst.
function shapes(forProgress: boolean): Set {
  if (forProgress)
    return (determinate ??= (() => {
      const turn = (Math.PI * 2) / 20
      const [c, s] = [Math.cos(turn), Math.sin(turn)]
      const polygons = [
        MaterialShapes.Circle.transformed((x, y) => [
          c * x - s * y,
          s * x + c * y
        ]),
        MaterialShapes.SoftBurst
      ]
      return {
        morphs: morphSequence(polygons, false),
        scale: scaleFactor(polygons)
      }
    })())
  return (indeterminate ??= (() => {
    const polygons = [
      MaterialShapes.SoftBurst,
      MaterialShapes.Cookie9Sided,
      MaterialShapes.Pentagon,
      MaterialShapes.Pill,
      MaterialShapes.Sunny,
      MaterialShapes.Cookie4Sided,
      MaterialShapes.Oval
    ]
    return {
      morphs: morphSequence(polygons, true),
      scale: scaleFactor(polygons)
    }
  })())
}

// The morph's spring: damping 0.6, stiffness 200, done once it's within
// 0.1 of the end and staying there. A new morph starts every 650ms, and
// the whole turns once every 4666ms.
const omega = Math.sqrt(200)
const zeta = 0.6
const omegaD = omega * Math.sqrt(1 - zeta * zeta)
const spring = (t: number) =>
  1 -
  Math.exp(-zeta * omega * t) *
    (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t))
const springEnd = (() => {
  const envelope = Math.sqrt(1 + ((zeta * omega) / omegaD) ** 2)
  return Math.log(envelope / 0.1) / (zeta * omega)
})()
const interval = 0.65
const fullTurn = 4.666

function bounds(cubics: Cubic[]) {
  const out = [Infinity, Infinity, -Infinity, -Infinity]
  const b = [0, 0, 0, 0]
  for (const c of cubics) {
    c.calculateBounds(b, false)
    out[0] = Math.min(out[0]!, b[0]!)
    out[1] = Math.min(out[1]!, b[1]!)
    out[2] = Math.max(out[2]!, b[2]!)
    out[3] = Math.max(out[3]!, b[3]!)
  }
  return out
}

export type LoadingIndicatorProps = {
  /** From 0 to 1, morphing a circle to a soft burst; leave it out to loop. */
  value?: number
  /** On a primary-container circle, for over content. */
  contained?: boolean
  'aria-label'?: string
  className?: string
  style?: CSSProperties
}

/**
 * An M3 Expressive loading indicator: shapes morphing and turning, for a
 * wait of a few seconds. 48dp, the shapes 38dp.
 */
export function LoadingIndicator({
  value,
  contained = false,
  className,
  style,
  ...props
}: LoadingIndicatorProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const clamped =
    value === undefined ? undefined : Math.min(1, Math.max(0, value))
  const progress = useRef(clamped)
  useLayoutEffect(() => {
    progress.current = clamped
  })
  const forProgress = clamped !== undefined

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { morphs, scale } = shapes(forProgress)
    const begun = performance.now()
    let frame = 0
    const paint = (now: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr))
        canvas.width = Math.round(w * dpr)
      if (canvas.height !== Math.round(h * dpr))
        canvas.height = Math.round(h * dpr)
      const s = getComputedStyle(canvas)
      const active = s
        .getPropertyValue(
          contained
            ? '--md-comp-loading-indicator-contained-active-color'
            : '--md-comp-loading-indicator-active-indicator-color'
        )
        .trim()
      const indicator =
        parseFloat(
          s.getPropertyValue('--md-comp-loading-indicator-active-size')
        ) / Math.min(w, h)
      let morph: Morph
      let at: number
      let degrees: number
      const p = progress.current
      if (p !== undefined) {
        // The morph index and progress within it, turning back 180°.
        const i = Math.min(Math.floor(morphs.length * p), morphs.length - 1)
        at = p === 1 && i === morphs.length - 1 ? 1 : (p * morphs.length) % 1
        morph = morphs[i]!
        degrees = -p * 180
      } else {
        // Each 650ms the next morph springs in, turning a quarter more.
        const t = (now - begun) / 1000
        const cycle = Math.floor(t / interval)
        const into = t - cycle * interval
        const done = into >= springEnd
        const index = done ? cycle + 1 : cycle
        at = done ? 0 : spring(into)
        morph = morphs[index % morphs.length]!
        const quarter = (90 * ((index + 1) % 4)) % 360
        degrees = at * 90 + quarter + ((t % fullTurn) / fullTurn) * 360
      }
      const cubics = morph.asCubics(at)
      const [l, t, r, b] = bounds(cubics)
      const size = Math.min(w, h) * scale * indicator
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.translate(w / 2, h / 2)
      ctx.rotate((degrees * Math.PI) / 180)
      ctx.scale(size, size)
      ctx.translate(-(l! + r!) / 2, -(t! + b!) / 2)
      ctx.fillStyle = active
      ctx.fill(toPath2D(cubics))
      frame = p === undefined ? requestAnimationFrame(paint) : 0
    }
    frame = requestAnimationFrame(paint)
    // A still indicator repaints when the theme or its size changes.
    const again = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }
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
  }, [forProgress, contained, clamped])

  return (
    <canvas
      ref={ref}
      role="progressbar"
      aria-label={props['aria-label']}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={
        clamped === undefined ? undefined : Math.round(clamped * 100)
      }
      className={[
        styles.indicator,
        contained && styles.contained,
        'md-comp-loading-indicator',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    />
  )
}
