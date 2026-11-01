// Ported from androidx graphics-shapes Cubic.kt at commit 1608250 (Apache-2.0).

import { Point } from './point'
import {
  convex,
  directionVector,
  distance,
  DistanceEpsilon,
  interpolate
} from './utils'

/** Kotlin's `TransformResult` (a `FloatFloatPair`): the transformed x and y. */
export type TransformResult = [number, number]

/** A function that can transform (rotate/scale/translate/etc.) points. */
export type PointTransformer = (x: number, y: number) => TransformResult

const inUnitRange = (t: number) => t >= 0 && t <= 1

/**
 * A single cubic Bézier curve: anchor points (anchor0X, anchor0Y) and (anchor1X, anchor1Y) at
 * either end and control points (control0X, control0Y) and (control1X, control1Y) between.
 */
export class Cubic {
  /** @internal The 8 coordinates: anchor0, control0, control1, anchor1. */
  readonly points: Float64Array

  /** Wraps an existing 8-element array without copying (Kotlin's internal constructor). */
  constructor(points: Float64Array)
  constructor(
    anchor0X: number,
    anchor0Y: number,
    control0X: number,
    control0Y: number,
    control1X: number,
    control1Y: number,
    anchor1X: number,
    anchor1Y: number
  )
  constructor(
    a: Float64Array | number,
    b = 0,
    c = 0,
    d = 0,
    e = 0,
    f = 0,
    g = 0,
    h = 0
  ) {
    if (typeof a === 'number') {
      this.points = Float64Array.of(a, b, c, d, e, f, g, h)
    } else {
      if (a.length !== 8) throw new Error('Points array size should be 8')
      this.points = a
    }
  }

  /** The first anchor point x coordinate */
  get anchor0X(): number {
    return this.points[0]!
  }

  /** The first anchor point y coordinate */
  get anchor0Y(): number {
    return this.points[1]!
  }

  /** The first control point x coordinate */
  get control0X(): number {
    return this.points[2]!
  }

  /** The first control point y coordinate */
  get control0Y(): number {
    return this.points[3]!
  }

  /** The second control point x coordinate */
  get control1X(): number {
    return this.points[4]!
  }

  /** The second control point y coordinate */
  get control1Y(): number {
    return this.points[5]!
  }

  /** The second anchor point x coordinate */
  get anchor1X(): number {
    return this.points[6]!
  }

  /** The second anchor point y coordinate */
  get anchor1Y(): number {
    return this.points[7]!
  }

  /**
   * @internal Returns the point on the curve at parameter [t], 0 being anchor0 and 1 anchor1.
   */
  pointOnCurve(t: number): Point {
    const u = 1 - t
    return new Point(
      this.anchor0X * (u * u * u) +
        this.control0X * (3 * t * u * u) +
        this.control1X * (3 * t * t * u) +
        this.anchor1X * (t * t * t),
      this.anchor0Y * (u * u * u) +
        this.control0Y * (3 * t * u * u) +
        this.control1Y * (3 * t * t * u) +
        this.anchor1Y * (t * t * t)
    )
  }

  /** @internal */
  zeroLength(): boolean {
    return (
      Math.abs(this.anchor0X - this.anchor1X) < DistanceEpsilon &&
      Math.abs(this.anchor0Y - this.anchor1Y) < DistanceEpsilon
    )
  }

  /** @internal */
  convexTo(next: Cubic): boolean {
    const prevVertex = new Point(this.anchor0X, this.anchor0Y)
    const currVertex = new Point(this.anchor1X, this.anchor1Y)
    const nextVertex = new Point(next.anchor1X, next.anchor1Y)
    return convex(prevVertex, currVertex, nextVertex)
  }

  private zeroIsh(value: number): boolean {
    return Math.abs(value) < DistanceEpsilon
  }

  /**
   * @internal Fills [bounds] with the true (or, if [approximate], the control-point) axis-aligned
   * bounds of this curve: left, top, right, bottom.
   */
  calculateBounds(
    bounds: number[] | Float64Array = new Float64Array(4),
    approximate = false
  ): void {
    // A curve might be of zero-length, with both anchors co-lated.
    // Just return the point itself.
    if (this.zeroLength()) {
      bounds[0] = this.anchor0X
      bounds[1] = this.anchor0Y
      bounds[2] = this.anchor0X
      bounds[3] = this.anchor0Y
      return
    }

    let minX = Math.min(this.anchor0X, this.anchor1X)
    let minY = Math.min(this.anchor0Y, this.anchor1Y)
    let maxX = Math.max(this.anchor0X, this.anchor1X)
    let maxY = Math.max(this.anchor0Y, this.anchor1Y)

    if (approximate) {
      // Approximate bounds use the bounding box of all anchors and controls
      bounds[0] = Math.min(minX, Math.min(this.control0X, this.control1X))
      bounds[1] = Math.min(minY, Math.min(this.control0Y, this.control1Y))
      bounds[2] = Math.max(maxX, Math.max(this.control0X, this.control1X))
      bounds[3] = Math.max(maxY, Math.max(this.control0Y, this.control1Y))
      return
    }

    // Find the derivative, which is a quadratic Bezier. Then we can solve for t using
    // the quadratic formula
    const xa =
      -this.anchor0X + 3 * this.control0X - 3 * this.control1X + this.anchor1X
    const xb = 2 * this.anchor0X - 4 * this.control0X + 2 * this.control1X
    const xc = -this.anchor0X + this.control0X

    if (this.zeroIsh(xa)) {
      // Try Muller's method instead; it can find a single root when a is 0
      if (xb !== 0) {
        const t = (2 * xc) / (-2 * xb)
        if (inUnitRange(t)) {
          const it = this.pointOnCurve(t).x
          if (it < minX) minX = it
          if (it > maxX) maxX = it
        }
      }
    } else {
      const xs = xb * xb - 4 * xa * xc
      if (xs >= 0) {
        const t1 = (-xb + Math.sqrt(xs)) / (2 * xa)
        if (inUnitRange(t1)) {
          const it = this.pointOnCurve(t1).x
          if (it < minX) minX = it
          if (it > maxX) maxX = it
        }

        const t2 = (-xb - Math.sqrt(xs)) / (2 * xa)
        if (inUnitRange(t2)) {
          const it = this.pointOnCurve(t2).x
          if (it < minX) minX = it
          if (it > maxX) maxX = it
        }
      }
    }

    // Repeat the above for y coordinate
    const ya =
      -this.anchor0Y + 3 * this.control0Y - 3 * this.control1Y + this.anchor1Y
    const yb = 2 * this.anchor0Y - 4 * this.control0Y + 2 * this.control1Y
    const yc = -this.anchor0Y + this.control0Y

    if (this.zeroIsh(ya)) {
      if (yb !== 0) {
        const t = (2 * yc) / (-2 * yb)
        if (inUnitRange(t)) {
          const it = this.pointOnCurve(t).y
          if (it < minY) minY = it
          if (it > maxY) maxY = it
        }
      }
    } else {
      const ys = yb * yb - 4 * ya * yc
      if (ys >= 0) {
        const t1 = (-yb + Math.sqrt(ys)) / (2 * ya)
        if (inUnitRange(t1)) {
          const it = this.pointOnCurve(t1).y
          if (it < minY) minY = it
          if (it > maxY) maxY = it
        }

        const t2 = (-yb - Math.sqrt(ys)) / (2 * ya)
        if (inUnitRange(t2)) {
          const it = this.pointOnCurve(t2).y
          if (it < minY) minY = it
          if (it > maxY) maxY = it
        }
      }
    }
    bounds[0] = minX
    bounds[1] = minY
    bounds[2] = maxX
    bounds[3] = maxY
  }

  /**
   * Returns two Cubics, created by splitting this curve at parameter [t] between the original
   * starting and ending anchor points.
   */
  // TODO: cartesian optimization?
  split(t: number): [Cubic, Cubic] {
    const u = 1 - t
    const pointOnCurve = this.pointOnCurve(t)
    return [
      new Cubic(
        this.anchor0X,
        this.anchor0Y,
        this.anchor0X * u + this.control0X * t,
        this.anchor0Y * u + this.control0Y * t,
        this.anchor0X * (u * u) +
          this.control0X * (2 * u * t) +
          this.control1X * (t * t),
        this.anchor0Y * (u * u) +
          this.control0Y * (2 * u * t) +
          this.control1Y * (t * t),
        pointOnCurve.x,
        pointOnCurve.y
      ),
      new Cubic(
        // TODO: should calculate once and share the result
        pointOnCurve.x,
        pointOnCurve.y,
        this.control0X * (u * u) +
          this.control1X * (2 * u * t) +
          this.anchor1X * (t * t),
        this.control0Y * (u * u) +
          this.control1Y * (2 * u * t) +
          this.anchor1Y * (t * t),
        this.control1X * u + this.anchor1X * t,
        this.control1Y * u + this.anchor1Y * t,
        this.anchor1X,
        this.anchor1Y
      )
    ]
  }

  /** Utility function to reverse the control/anchor points for this curve. */
  reverse(): Cubic {
    return new Cubic(
      this.anchor1X,
      this.anchor1Y,
      this.control1X,
      this.control1Y,
      this.control0X,
      this.control0Y,
      this.anchor0X,
      this.anchor0Y
    )
  }

  /** Kotlin's `c0 + c1`. */
  plus(o: Cubic): Cubic {
    return new Cubic(this.points.map((v, i) => v + o.points[i]!))
  }

  /** Kotlin's `c0 * x`. */
  times(x: number): Cubic {
    return new Cubic(this.points.map((v) => v * x))
  }

  /** Kotlin's `c0 / x`. */
  div(x: number): Cubic {
    return this.times(1 / x)
  }

  toString(): string {
    return (
      `anchor0: (${this.anchor0X}, ${this.anchor0Y}) control0: (${this.control0X}, ${this.control0Y}), ` +
      `control1: (${this.control1X}, ${this.control1Y}), anchor1: (${this.anchor1X}, ${this.anchor1Y})`
    )
  }

  /** Kotlin's `equals`: same 8 coordinates. */
  equals(other: unknown): boolean {
    if (this === other) return true
    if (!(other instanceof Cubic)) return false
    for (let i = 0; i < 8; i++) {
      if (!Object.is(this.points[i], other.points[i])) return false
    }
    return true
  }

  /** Transforms the points in this [Cubic] with [f] and returns a new [Cubic]. */
  transformed(f: PointTransformer): Cubic {
    const newCubic = new MutableCubic()
    newCubic.points.set(this.points)
    newCubic.transform(f)
    return newCubic
  }

  /**
   * A straight line between the given anchor points, with the control points 1/3 of the distance
   * from their respective anchor points.
   */
  static straightLine(x0: number, y0: number, x1: number, y1: number): Cubic {
    return new Cubic(
      x0,
      y0,
      interpolate(x0, x1, 1 / 3),
      interpolate(y0, y1, 1 / 3),
      interpolate(x0, x1, 2 / 3),
      interpolate(y0, y1, 2 / 3),
      x1,
      y1
    )
  }

  // TODO: consider a more general function (maybe in addition to this) that allows
  // caller to get a list of curves surpassing 180 degrees
  /**
   * A curve approximating the smaller circular arc from p0 to p1 around the center; arcs over 180
   * degrees need several. p0 and p1 should be equidistant from the center.
   */
  static circularArc(
    centerX: number,
    centerY: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): Cubic {
    const p0d = directionVector(x0 - centerX, y0 - centerY)
    const p1d = directionVector(x1 - centerX, y1 - centerY)
    const rotatedP0 = p0d.rotate90()
    const rotatedP1 = p1d.rotate90()
    const clockwise = rotatedP0.dotProductXY(x1 - centerX, y1 - centerY) >= 0
    const cosa = p0d.dotProduct(p1d)
    if (cosa > 0.999) /* p0 ~= p1 */ return Cubic.straightLine(x0, y0, x1, y1)
    const k =
      ((((distance(x0 - centerX, y0 - centerY) * 4) / 3) *
        (Math.sqrt(2 * (1 - cosa)) - Math.sqrt(1 - cosa * cosa))) /
        (1 - cosa)) *
      (clockwise ? 1 : -1)
    return new Cubic(
      x0,
      y0,
      x0 + rotatedP0.x * k,
      y0 + rotatedP0.y * k,
      x1 - rotatedP1.x * k,
      y1 - rotatedP1.y * k,
      x1,
      y1
    )
  }

  /** @internal An empty Cubic defined at (x0, y0). */
  static empty(x0: number, y0: number): Cubic {
    return new Cubic(x0, y0, x0, y0, x0, y0, x0, y0)
  }
}

/** @internal Kotlin's internal `Cubic(anchor0, control0, control1, anchor1)` constructor. */
export function cubicOf(
  anchor0: Point,
  control0: Point,
  control1: Point,
  anchor1: Point
): Cubic {
  return new Cubic(
    anchor0.x,
    anchor0.y,
    control0.x,
    control0.y,
    control1.x,
    control1.y,
    anchor1.x,
    anchor1.y
  )
}

/**
 * A mutable [Cubic], for performance-critical paths such as [Morph.forEachCubic] that reuse one
 * instance instead of creating new ones.
 */
export class MutableCubic extends Cubic {
  constructor() {
    super(new Float64Array(8))
  }

  private transformOnePoint(f: PointTransformer, ix: number): void {
    const result = f(this.points[ix]!, this.points[ix + 1]!)
    this.points[ix] = result[0]
    this.points[ix + 1] = result[1]
  }

  transform(f: PointTransformer): void {
    this.transformOnePoint(f, 0)
    this.transformOnePoint(f, 2)
    this.transformOnePoint(f, 4)
    this.transformOnePoint(f, 6)
  }

  interpolate(c1: Cubic, c2: Cubic, progress: number): void {
    for (let i = 0; i < 8; i++) {
      this.points[i] = interpolate(c1.points[i]!, c2.points[i]!, progress)
    }
  }
}
