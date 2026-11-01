// Ported from androidx graphics-shapes CornerRounding.kt at commit 1608250 (Apache-2.0).

/**
 * The amount and quality of rounding around a vertex. [radius] is the radius of the circle that
 * forms the basis of the rounding (0 is a sharp corner); [smoothing] (0..1) is how far the curve
 * is extended from the circular arc towards the edges, 0 being a pure circular arc and 1 leaving
 * no circular arc at all.
 */
export class CornerRounding {
  /** A rounding radius of zero, producing a sharp corner at a vertex. */
  static readonly Unrounded = new CornerRounding()

  readonly radius: number
  readonly smoothing: number

  constructor(radius = 0, smoothing = 0) {
    this.radius = radius
    this.smoothing = smoothing
  }
}
