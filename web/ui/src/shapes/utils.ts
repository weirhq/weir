// Ported from androidx graphics-shapes Utils.kt at commit 1608250 (Apache-2.0).

import { Point } from './point'

export function distance(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

export function distanceSquared(x: number, y: number): number {
  return x * x + y * y
}

/** Returns unit vector representing the direction to this point from (0, 0). */
export function directionVector(x: number, y: number): Point {
  const d = distance(x, y)
  if (!(d > 0)) throw new Error('Required distance greater than zero')
  return new Point(x / d, y / d)
}

export function directionVectorAngle(angleRadians: number): Point {
  return new Point(Math.cos(angleRadians), Math.sin(angleRadians))
}

export function radialToCartesian(
  radius: number,
  angleRadians: number,
  center: Point = Zero
): Point {
  return directionVectorAngle(angleRadians).times(radius).plus(center)
}

/**
 * Used to determine when two points are the same, within some reasonable roundoff error. The
 * distance epsilon is smaller, so roundoff stays below a pixel on any reasonable display.
 */
export const DistanceEpsilon = 1e-4
export const AngleEpsilon = 1e-6

/**
 * People see e.g. collinearity much more relaxed than what is mathematically correct; use this
 * for operations that allow higher tolerances.
 */
export const RelaxedDistanceEpsilon = 5e-3

export const Zero = new Point(0, 0)

export const FloatPi = Math.PI

export const TwoPi = 2 * Math.PI

/** Kotlin's `Float.MAX_VALUE`. */
export const FloatMaxValue = 3.4028234663852886e38

/** Kotlin's `Float.MIN_VALUE`: the smallest positive Float, not the most negative one. */
export const FloatMinValue = 1.401298464324817e-45

export function square(x: number): number {
  return x * x
}

/** Linearly interpolate between [start] and [stop] with [fraction] fraction between them. */
export function interpolate(
  start: number,
  stop: number,
  fraction: number
): number {
  return (1 - fraction) * start + fraction * stop
}

/** Similar to num % mod, but the result is always positive: -4 % 3 = -1, positiveModulo = 2. */
export function positiveModulo(num: number, mod: number): number {
  return ((num % mod) + mod) % mod
}

/** Returns whether C is on the line defined by the two points AB. */
export function collinearIsh(
  aX: number,
  aY: number,
  bX: number,
  bY: number,
  cX: number,
  cY: number,
  tolerance: number = DistanceEpsilon
): boolean {
  // The dot product of a perpendicular angle is 0. By rotating one of the vectors,
  // we save the calculations to convert the dot product to degrees afterwards.
  const ab = new Point(bX - aX, bY - aY).rotate90()
  const ac = new Point(cX - aX, cY - aY)
  const dotProduct = Math.abs(ab.dotProduct(ac))
  const relativeTolerance = tolerance * ab.getDistance() * ac.getDistance()

  return dotProduct < tolerance || dotProduct < relativeTolerance
}

/**
 * Approximates whether corner at this vertex is concave or convex, based on the relationship of
 * the prev->curr/curr->next vectors.
 */
export function convex(previous: Point, current: Point, next: Point): boolean {
  // TODO: b/369320447 - This is a fast, but not reliable calculation.
  return current.minus(previous).clockwise(next.minus(current))
}

/**
 * Ternary search in [v0..v1] for the parameter that minimizes [f], stopping when the search
 * space is smaller than [tolerance].
 */
export function findMinimum(
  v0: number,
  v1: number,
  tolerance: number = 1e-3,
  f: (value: number) => number
): number {
  let a = v0
  let b = v1
  while (b - a > tolerance) {
    const c1 = (2 * a + b) / 3
    const c2 = (2 * b + a) / 3
    if (f(c1) < f(c2)) {
      b = c2
    } else {
      a = c1
    }
  }
  return (a + b) / 2
}
