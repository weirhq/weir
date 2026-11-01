// Ported from androidx graphics-shapes Point.kt at commit 1608250 (Apache-2.0).

import type { PointTransformer } from './cubic'

/** An immutable 2D point (or vector), Kotlin's `FloatFloatPair` typealias. */
export class Point {
  readonly x: number
  readonly y: number

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }

  copy(x: number = this.x, y: number = this.y): Point {
    return new Point(x, y)
  }

  /** The distance of this point from (0, 0). */
  getDistance(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y)
  }

  /** The square of [getDistance], cheaper to compute. */
  getDistanceSquared(): number {
    return this.x * this.x + this.y * this.y
  }

  dotProduct(other: Point): number {
    return this.x * other.x + this.y * other.y
  }

  dotProductXY(otherX: number, otherY: number): number {
    return this.x * otherX + this.y * otherY
  }

  /**
   * Whether [other] turns clockwise (> 0) from this vector, from the Z coordinate of the
   * cross product. Co-linear vectors are not clockwise.
   */
  clockwise(other: Point): boolean {
    return this.x * other.y - this.y * other.x > 0
  }

  /** Unit vector representing the direction to this point from (0, 0). */
  getDirection(): Point {
    const d = this.getDistance()
    if (!(d > 0))
      throw new Error("Can't get the direction of a 0-length vector")
    return this.div(d)
  }

  negate(): Point {
    return new Point(-this.x, -this.y)
  }

  minus(other: Point): Point {
    return new Point(this.x - other.x, this.y - other.y)
  }

  plus(other: Point): Point {
    return new Point(this.x + other.x, this.y + other.y)
  }

  times(operand: number): Point {
    return new Point(this.x * operand, this.y * operand)
  }

  div(operand: number): Point {
    return new Point(this.x / operand, this.y / operand)
  }

  rem(operand: number): Point {
    return new Point(this.x % operand, this.y % operand)
  }

  /** From Utils.kt. */
  rotate90(): Point {
    return new Point(-this.y, this.x)
  }

  transformed(f: PointTransformer): Point {
    const result = f(this.x, this.y)
    return new Point(result[0], result[1])
  }
}

/** Linearly interpolate between two Points. */
export function interpolatePoint(
  start: Point,
  stop: Point,
  fraction: number
): Point {
  return new Point(
    (1 - fraction) * start.x + fraction * stop.x,
    (1 - fraction) * start.y + fraction * stop.y
  )
}
