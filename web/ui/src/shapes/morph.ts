// Ported from androidx graphics-shapes Morph.kt at commit 1608250 (Apache-2.0).

import { Cubic, MutableCubic } from './cubic'
import { featureMapper } from './feature-mapping'
import {
  LengthMeasurer,
  MeasuredPolygon,
  type MeasuredCubic
} from './polygon-measure'
import type { RoundedPolygon } from './rounded-polygon'
import { AngleEpsilon, interpolate, positiveModulo } from './utils'

/**
 * Animates between start and end polygons. Both are contiguous outlines made only of cubics, so
 * they differ only in the number and placement of their curves; the morph maps the curves of the
 * two shapes together (by proximity, vertices and concavity), splitting curves where the shapes
 * do not have the same number of curves or where their placement differs a lot.
 */
export class Morph {
  private readonly start: RoundedPolygon
  private readonly end: RoundedPolygon

  /**
   * @internal All cubics needed to represent the start and end shapes (the originals may be cut
   * to align them), matched one to one in each pair.
   */
  readonly morphMatch: readonly (readonly [Cubic, Cubic])[]

  constructor(start: RoundedPolygon, end: RoundedPolygon) {
    this.start = start
    this.end = end
    this.morphMatch = Morph.match(start, end)
  }

  /**
   * The axis-aligned bounds of both shapes, as left, top, right, bottom. When [approximate]
   * (the default), uses the min/max of all anchor and control points, which is faster.
   */
  calculateBounds(
    bounds: number[] = [0, 0, 0, 0],
    approximate = true
  ): number[] {
    this.start.calculateBounds(bounds, approximate)
    const minX = bounds[0]!
    const minY = bounds[1]!
    const maxX = bounds[2]!
    const maxY = bounds[3]!
    this.end.calculateBounds(bounds, approximate)
    bounds[0] = Math.min(minX, bounds[0]!)
    bounds[1] = Math.min(minY, bounds[1]!)
    bounds[2] = Math.max(maxX, bounds[2]!)
    bounds[3] = Math.max(maxY, bounds[3]!)
    return bounds
  }

  /**
   * Like [calculateBounds], but returns a square, around each shape's center, that can hold the
   * object in any rotation.
   */
  calculateMaxBounds(bounds: number[] = [0, 0, 0, 0]): number[] {
    this.start.calculateMaxBounds(bounds)
    const minX = bounds[0]!
    const minY = bounds[1]!
    const maxX = bounds[2]!
    const maxY = bounds[3]!
    this.end.calculateMaxBounds(bounds)
    bounds[0] = Math.min(minX, bounds[0]!)
    bounds[1] = Math.min(minY, bounds[1]!)
    bounds[2] = Math.max(maxX, bounds[2]!)
    bounds[3] = Math.max(maxY, bounds[3]!)
    return bounds
  }

  /**
   * The morph at [progress] (0 is the start shape, 1 the end shape) as a new list of Cubics.
   * Values slightly outside [0..1] can be used for overshoot effects.
   */
  asCubics(progress: number): Cubic[] {
    const result: Cubic[] = []
    // The first/last mechanism here ensures that the final anchor point in the shape
    // exactly matches the first anchor point. There can be rendering artifacts introduced
    // by those points being slightly off, even by much less than a pixel
    let firstCubic: Cubic | null = null
    let lastCubic: Cubic | null = null
    for (let i = 0; i < this.morphMatch.length; i++) {
      const [a, b] = this.morphMatch[i]!
      const points = new Float64Array(8)
      for (let it = 0; it < 8; it++) {
        points[it] = interpolate(a.points[it]!, b.points[it]!, progress)
      }
      const cubic = new Cubic(points)
      if (firstCubic === null) firstCubic = cubic
      if (lastCubic !== null) result.push(lastCubic)
      lastCubic = cubic
    }
    if (lastCubic !== null && firstCubic !== null) {
      result.push(
        new Cubic(
          lastCubic.anchor0X,
          lastCubic.anchor0Y,
          lastCubic.control0X,
          lastCubic.control0Y,
          lastCubic.control1X,
          lastCubic.control1Y,
          firstCubic.anchor0X,
          firstCubic.anchor0Y
        )
      )
    }
    return result
  }

  /**
   * Calls [callback] with each cubic of the morph at [progress]. Faster than [asCubics] as it
   * reuses one [MutableCubic] instead of allocating new Cubics.
   */
  forEachCubic(
    progress: number,
    callback: (cubic: MutableCubic) => void,
    mutableCubic: MutableCubic = new MutableCubic()
  ): void {
    for (let i = 0; i < this.morphMatch.length; i++) {
      const [a, b] = this.morphMatch[i]!
      mutableCubic.interpolate(a, b, progress)
      callback(mutableCubic)
    }
  }

  /**
   * @internal Builds the matched cubic pairs. Measures where the curves are along each outline,
   * maps features with [featureMapper], then walks both outlines, cutting curves so that each
   * pair spans the same progress.
   */
  static match(
    p1: RoundedPolygon,
    p2: RoundedPolygon
  ): (readonly [Cubic, Cubic])[] {
    // Measure polygons, returns lists of measured cubics for each polygon, which
    // we then use to match start/end curves
    const measuredPolygon1 = MeasuredPolygon.measurePolygon(
      new LengthMeasurer(),
      p1
    )
    const measuredPolygon2 = MeasuredPolygon.measurePolygon(
      new LengthMeasurer(),
      p2
    )

    // features1 and 2 will contain the list of corners (just the inner circular curve)
    // along with the progress at the middle of those corners. These measurement values
    // are then used to compare and match between the two polygons
    const features1 = measuredPolygon1.features
    const features2 = measuredPolygon2.features

    // Map features: doubleMapper is the result of mapping the features in each shape to the
    // closest feature in the other shape.
    // Given a progress in one of the shapes it can be used to find the corresponding
    // progress in the other shape (in both directions)
    const doubleMapper = featureMapper(features1, features2)

    // cut point on poly2 is the mapping of the 0 point on poly1
    const polygon2CutPoint = doubleMapper.map(0)

    // Cut and rotate.
    // Polygons start at progress 0, and the featureMapper has decided that we want to match
    // progress 0 in the first polygon to `polygon2CutPoint` on the second polygon.
    // So we need to cut the second polygon there and "rotate it", so as we walk through
    // both polygons we can find the matching.
    // The resulting bs1/2 are MeasuredPolygons, whose MeasuredCubics start from
    // outlineProgress=0 and increasing until outlineProgress=1
    const bs1 = measuredPolygon1
    const bs2 = measuredPolygon2.cutAndShift(polygon2CutPoint)

    // Match
    // Now we can compare the two lists of measured cubics and create a list of pairs
    // of cubics [ret], which are the start/end curves that represent the Morph object
    // and the start and end shapes, and which can be interpolated to animate the
    // between those shapes.
    const ret: (readonly [Cubic, Cubic])[] = []
    // i1/i2 are the indices of the current cubic on the start (1) and end (2) shapes
    let i1 = 0
    let i2 = 0
    // b1, b2 are the current measured cubic for each polygon
    let b1: MeasuredCubic | null = bs1.getOrNull(i1++)
    let b2: MeasuredCubic | null = bs2.getOrNull(i2++)
    // Iterate until all curves are accounted for and matched
    while (b1 !== null && b2 !== null) {
      // Progresses are in shape1's perspective
      // b1a, b2a are ending progress values of current measured cubics in [0,1] range
      const b1a = i1 === bs1.size ? 1 : b1.endOutlineProgress
      const b2a =
        i2 === bs2.size
          ? 1
          : doubleMapper.mapBack(
              positiveModulo(b2.endOutlineProgress + polygon2CutPoint, 1)
            )
      const minb = Math.min(b1a, b2a)
      // min b is the progress at which the curve that ends first ends.
      // If both curves ends roughly there, no cutting is needed, we have a match.
      // If one curve extends beyond, we need to cut it.
      let seg1: MeasuredCubic
      let newb1: MeasuredCubic | null
      if (b1a > minb + AngleEpsilon) {
        ;[seg1, newb1] = b1.cutAtProgress(minb)
      } else {
        seg1 = b1
        newb1 = bs1.getOrNull(i1++)
      }
      let seg2: MeasuredCubic
      let newb2: MeasuredCubic | null
      if (b2a > minb + AngleEpsilon) {
        ;[seg2, newb2] = b2.cutAtProgress(
          positiveModulo(doubleMapper.map(minb) - polygon2CutPoint, 1)
        )
      } else {
        seg2 = b2
        newb2 = bs2.getOrNull(i2++)
      }
      ret.push([seg1.cubic, seg2.cubic])
      b1 = newb1
      b2 = newb2
    }
    if (!(b1 === null && b2 === null)) {
      throw new Error("Expected both Polygon's Cubic to be fully matched")
    }
    return ret
  }
}
