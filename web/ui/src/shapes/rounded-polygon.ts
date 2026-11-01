// Ported from androidx graphics-shapes RoundedPolygon.kt at commit 1608250 (Apache-2.0).

import { CornerRounding } from './corner-rounding'
import { Cubic, cubicOf, type PointTransformer } from './cubic'
import { Corner, Edge, Feature } from './features'
import { interpolatePoint, Point } from './point'
import {
  circle,
  pill,
  pillStar,
  rectangle,
  star,
  type CircleOptions,
  type PillOptions,
  type PillStarOptions,
  type RectangleOptions,
  type StarOptions
} from './shapes'
import {
  convex,
  directionVector,
  distance,
  distanceSquared,
  DistanceEpsilon,
  FloatMaxValue,
  FloatMinValue,
  FloatPi,
  radialToCartesian,
  square
} from './utils'

/** Vertices as x/y pairs, Kotlin's `FloatArray`. */
export type Vertices = readonly number[] | Float32Array | Float64Array

export interface NumVerticesOptions {
  /** The radius of the polygon; default 1. */
  radius?: number
  /** The center around which all vertices are placed; default (0, 0). */
  centerX?: number
  centerY?: number
  /** Rounding for every vertex; default [CornerRounding.Unrounded]. */
  rounding?: CornerRounding
  /** Rounding for each vertex; if given it must have numVertices elements. */
  perVertexRounding?: readonly CornerRounding[] | null
}

export interface VerticesOptions {
  /** Rounding for every vertex; default [CornerRounding.Unrounded]. */
  rounding?: CornerRounding
  /** Rounding for each vertex; if given it must have vertices.length / 2 elements. */
  perVertexRounding?: readonly CornerRounding[] | null
  /** The center; by default (Kotlin's Float.MIN_VALUE sentinel) the average of the vertices. */
  centerX?: number
  centerY?: number
}

export interface FeaturesOptions {
  /** The center; by default (NaN) the average of all cubic anchor points. */
  centerX?: number
  centerY?: number
}

type Resolved = [readonly Feature[], Point]

/**
 * Polygonal shapes with optional rounding at the vertices, built from a number of vertices, an
 * ordered list of vertices, or a list of [Feature]s.
 */
export class RoundedPolygon {
  readonly features: readonly Feature[]
  /** @internal */
  readonly center: Point
  /** A flattened version of the [Feature]s. */
  readonly cubics: readonly Cubic[]

  /**
   * [numVertices] vertices placed at [NumVerticesOptions.radius] (default 1) from the center at
   * equal angles, so the default shape lies on the unit circle.
   * @throws Error if perVertexRounding's size is not numVertices, or numVertices < 3
   */
  constructor(numVertices: number, options?: NumVerticesOptions)
  /**
   * An ordered list of vertices as x/y pairs, rounded as specified.
   * @throws Error if there are fewer than 3 vertices, an odd number of values, or
   *   perVertexRounding's size doesn't match the number of vertices
   */
  constructor(vertices: Vertices, options?: VerticesOptions)
  /**
   * The features that describe the outline; this controls how [Morph] maps the shape.
   * @throws Error with fewer than 2 features or if they don't describe a closed shape
   */
  constructor(features: readonly Feature[], options?: FeaturesOptions)
  /** @internal Kotlin's internal primary constructor. */
  constructor(features: readonly Feature[], center: Point)
  /** Creates a copy of [source]. */
  constructor(source: RoundedPolygon)
  constructor(
    arg: number | Vertices | readonly Feature[] | RoundedPolygon,
    options?: NumVerticesOptions | VerticesOptions | FeaturesOptions | Point
  ) {
    const [features, center] = resolve(arg, options)
    this.features = features
    this.center = center
    this.cubics = buildCubics(features, center)

    let prevCubic = this.cubics[this.cubics.length - 1]!
    for (let index = 0; index < this.cubics.length; index++) {
      const cubic = this.cubics[index]!
      if (
        Math.abs(cubic.anchor0X - prevCubic.anchor1X) > DistanceEpsilon ||
        Math.abs(cubic.anchor0Y - prevCubic.anchor1Y) > DistanceEpsilon
      ) {
        throw new Error(
          'RoundedPolygon must be contiguous, with the anchor points of all curves ' +
            'matching the anchor points of the preceding and succeeding cubics'
        )
      }
      prevCubic = cubic
    }
  }

  get centerX(): number {
    return this.center.x
  }

  get centerY(): number {
    return this.center.y
  }

  /** Transforms (scales/translates/etc.) this polygon with [f] and returns a new one. */
  transformed(f: PointTransformer): RoundedPolygon {
    const center = this.center.transformed(f)
    const features: Feature[] = []
    for (let i = 0; i < this.features.length; i++) {
      features.push(this.features[i]!.transformed(f))
    }
    return new RoundedPolygon(features, center)
  }

  /**
   * A new RoundedPolygon, moved and resized so it's completely inside the (0, 0) -> (1, 1)
   * square, centered if there is extra space in one direction.
   */
  normalized(): RoundedPolygon {
    const bounds = this.calculateBounds()
    const width = bounds[2]! - bounds[0]!
    const height = bounds[3]! - bounds[1]!
    const side = Math.max(width, height)
    // Center the shape if bounds are not a square
    const offsetX = (side - width) / 2 - bounds[0]! /* left */
    const offsetY = (side - height) / 2 - bounds[1]! /* top */
    return this.transformed((x, y) => [
      (x + offsetX) / side,
      (y + offsetY) / side
    ])
  }

  toString(): string {
    return (
      '[RoundedPolygon.' +
      ' Cubics = ' +
      this.cubics.join(', ') +
      ' || Features = ' +
      this.features.join(', ') +
      ` || Center = (${this.centerX}, ${this.centerY})]`
    )
  }

  /**
   * Like [calculateBounds], but returns a square around the center that can hold the shape in
   * any rotation, from the distance of the start and midpoint of each curve to the center.
   */
  calculateMaxBounds(bounds: number[] = [0, 0, 0, 0]): number[] {
    if (!(bounds.length >= 4)) throw new Error('Required bounds size of 4')
    let maxDistSquared = 0
    for (let i = 0; i < this.cubics.length; i++) {
      const cubic = this.cubics[i]!
      const anchorDistance = distanceSquared(
        cubic.anchor0X - this.centerX,
        cubic.anchor0Y - this.centerY
      )
      const middlePoint = cubic.pointOnCurve(0.5)
      const middleDistance = distanceSquared(
        middlePoint.x - this.centerX,
        middlePoint.y - this.centerY
      )
      maxDistSquared = Math.max(
        maxDistSquared,
        Math.max(anchorDistance, middleDistance)
      )
    }
    const distance = Math.sqrt(maxDistSquared)
    bounds[0] = this.centerX - distance
    bounds[1] = this.centerY - distance
    bounds[2] = this.centerX + distance
    bounds[3] = this.centerY + distance
    return bounds
  }

  /**
   * The axis-aligned bounds as left, top, right, bottom. When [approximate] (the default), uses
   * the min/max of all anchor and control points, which is faster.
   */
  calculateBounds(
    bounds: number[] = [0, 0, 0, 0],
    approximate = true
  ): number[] {
    if (!(bounds.length >= 4)) throw new Error('Required bounds size of 4')
    let minX = FloatMaxValue
    let minY = FloatMaxValue
    // Kotlin's Float.MIN_VALUE is the smallest positive Float; kept as in the original.
    let maxX = FloatMinValue
    let maxY = FloatMinValue
    for (let i = 0; i < this.cubics.length; i++) {
      const cubic = this.cubics[i]!
      cubic.calculateBounds(bounds, approximate)
      minX = Math.min(minX, bounds[0]!)
      minY = Math.min(minY, bounds[1]!)
      maxX = Math.max(maxX, bounds[2]!)
      maxY = Math.max(maxY, bounds[3]!)
    }
    bounds[0] = minX
    bounds[1] = minY
    bounds[2] = maxX
    bounds[3] = maxY
    return bounds
  }

  /** Kotlin's `equals`: the same features. */
  equals(other: unknown): boolean {
    if (this === other) return true
    if (!(other instanceof RoundedPolygon)) return false
    if (this.features.length !== other.features.length) return false
    return this.features.every((f, i) => f === other.features[i])
  }

  // Shapes.kt companion extensions.

  /** A circle, approximated by rounding the vertices of a polygon. */
  static circle(numVertices = 8, options?: CircleOptions): RoundedPolygon {
    return circle(numVertices, options)
  }

  /** A rectangle, optionally with rounded corners. */
  static rectangle(options?: RectangleOptions): RoundedPolygon {
    return rectangle(options)
  }

  /** A star: a polygon whose vertices alternate between an outer and inner radius. */
  static star(
    numVerticesPerRadius: number,
    options?: StarOptions
  ): RoundedPolygon {
    return star(numVerticesPerRadius, options)
  }

  /** A rectangle bounded by two semicircles at either of the long ends. */
  static pill(options?: PillOptions): RoundedPolygon {
    return pill(options)
  }

  /** A [pill] with inner and outer radii along its outline, like a [star]. */
  static pillStar(options?: PillStarOptions): RoundedPolygon {
    return pillStar(options)
  }
}

function isVertices(arg: Vertices | readonly Feature[]): arg is Vertices {
  if (ArrayBuffer.isView(arg)) return true
  return !(arg[0] instanceof Feature)
}

function resolve(
  arg: number | Vertices | readonly Feature[] | RoundedPolygon,
  options:
    NumVerticesOptions | VerticesOptions | FeaturesOptions | Point | undefined
): Resolved {
  if (arg instanceof RoundedPolygon) return [arg.features, arg.center]
  if (options instanceof Point) return [arg as readonly Feature[], options]
  if (typeof arg === 'number') {
    const o = (options ?? {}) as NumVerticesOptions
    const radius = o.radius ?? 1
    const centerX = o.centerX ?? 0
    const centerY = o.centerY ?? 0
    return fromVertices(
      verticesFromNumVerts(arg, radius, centerX, centerY),
      o.rounding ?? CornerRounding.Unrounded,
      o.perVertexRounding ?? null,
      centerX,
      centerY
    )
  }
  if (isVertices(arg)) {
    const o = (options ?? {}) as VerticesOptions
    return fromVertices(
      arg,
      o.rounding ?? CornerRounding.Unrounded,
      o.perVertexRounding ?? null,
      o.centerX ?? FloatMinValue,
      o.centerY ?? FloatMinValue
    )
  }
  const o = (options ?? {}) as FeaturesOptions
  return fromFeatures(arg, o.centerX ?? NaN, o.centerY ?? NaN)
}

function buildCubics(features: readonly Feature[], center: Point): Cubic[] {
  const result: Cubic[] = []
  // The first/last mechanism here ensures that the final anchor point in the shape
  // exactly matches the first anchor point. There can be rendering artifacts introduced
  // by those points being slightly off, even by much less than a pixel
  let firstCubic: Cubic | null = null
  let lastCubic: Cubic | null = null
  let firstFeatureSplitStart: Cubic[] | null = null
  let firstFeatureSplitEnd: Cubic[] | null = null
  if (features.length > 0 && features[0]!.cubics.length === 3) {
    const centerCubic = features[0]!.cubics[1]!
    const [start, end] = centerCubic.split(0.5)
    firstFeatureSplitStart = [features[0]!.cubics[0]!, start]
    firstFeatureSplitEnd = [end, features[0]!.cubics[2]!]
  }
  // iterating one past the features list size allows us to insert the initial split
  // cubic if it exists
  for (let i = 0; i <= features.length; i++) {
    let featureCubics: readonly Cubic[]
    if (i === 0 && firstFeatureSplitEnd !== null) {
      featureCubics = firstFeatureSplitEnd
    } else if (i === features.length) {
      if (firstFeatureSplitStart !== null)
        featureCubics = firstFeatureSplitStart
      else break
    } else {
      featureCubics = features[i]!.cubics
    }
    for (let j = 0; j < featureCubics.length; j++) {
      // Skip zero-length curves; they add nothing and can trigger rendering artifacts
      const cubic = featureCubics[j]!
      if (!cubic.zeroLength()) {
        if (lastCubic !== null) result.push(lastCubic)
        lastCubic = cubic
        if (firstCubic === null) firstCubic = cubic
      } else {
        if (lastCubic !== null) {
          // Dropping several zero-ish length curves in a row can lead to
          // enough discontinuity to throw an exception later, even though the
          // distances are quite small. Account for that by making the last
          // cubic use the latest anchor point, always.
          lastCubic = new Cubic(lastCubic.points.slice()) // Make a copy before mutating
          lastCubic.points[6] = cubic.anchor1X
          lastCubic.points[7] = cubic.anchor1Y
        }
      }
    }
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
  } else {
    // Empty / 0-sized polygon.
    const { x, y } = center
    result.push(new Cubic(x, y, x, y, x, y, x, y))
  }
  return result
}

/**
 * Kotlin's `RoundedPolygon(vertices, rounding, perVertexRounding, centerX, centerY)`: rounds the
 * corners at each vertex and joins them with straight edges.
 */
function fromVertices(
  vertices: Vertices,
  rounding: CornerRounding,
  perVertexRounding: readonly CornerRounding[] | null,
  centerX: number,
  centerY: number
): Resolved {
  if (vertices.length < 6) {
    throw new Error('Polygons must have at least 3 vertices')
  }
  if (vertices.length % 2 === 1) {
    throw new Error('The vertices array should have even size')
  }
  if (
    perVertexRounding !== null &&
    perVertexRounding.length * 2 !== vertices.length
  ) {
    throw new Error(
      'perVertexRounding list should be either null or ' +
        'the same size as the number of vertices (vertices.size / 2)'
    )
  }
  const v = (i: number) => vertices[i]!
  const corners: Cubic[][] = []
  const n = vertices.length / 2
  const roundedCorners: RoundedCorner[] = []
  for (let i = 0; i < n; i++) {
    const vtxRounding = perVertexRounding?.[i] ?? rounding
    const prevIndex = ((i + n - 1) % n) * 2
    const nextIndex = ((i + 1) % n) * 2
    roundedCorners.push(
      new RoundedCorner(
        new Point(v(prevIndex), v(prevIndex + 1)),
        new Point(v(i * 2), v(i * 2 + 1)),
        new Point(v(nextIndex), v(nextIndex + 1)),
        vtxRounding
      )
    )
  }

  // For each side, check if we have enough space to do the cuts needed, and if not split
  // the available space, first for round cuts, then for smoothing if there is space left.
  // Each element in this list is a pair, that represent how much we can do of the cut for
  // the given side (side i goes from corner i to corner i+1), the elements of the pair are:
  // first is how much we can use of expectedRoundCut, second how much of expectedCut
  const cutAdjusts: [number, number][] = []
  for (let ix = 0; ix < n; ix++) {
    const expectedRoundCut =
      roundedCorners[ix]!.expectedRoundCut +
      roundedCorners[(ix + 1) % n]!.expectedRoundCut
    const expectedCut =
      roundedCorners[ix]!.expectedCut +
      roundedCorners[(ix + 1) % n]!.expectedCut
    const vtxX = v(ix * 2)
    const vtxY = v(ix * 2 + 1)
    const nextVtxX = v(((ix + 1) % n) * 2)
    const nextVtxY = v(((ix + 1) % n) * 2 + 1)
    const sideSize = distance(vtxX - nextVtxX, vtxY - nextVtxY)

    // Check expectedRoundCut first, and ensure we fulfill rounding needs first for
    // both corners before using space for smoothing
    if (expectedRoundCut > sideSize) {
      // Not enough room for fully rounding, see how much we can actually do.
      cutAdjusts.push([sideSize / expectedRoundCut, 0])
    } else if (expectedCut > sideSize) {
      // We can do full rounding, but not full smoothing.
      cutAdjusts.push([
        1,
        (sideSize - expectedRoundCut) / (expectedCut - expectedRoundCut)
      ])
    } else {
      // There is enough room for rounding & smoothing.
      cutAdjusts.push([1, 1])
    }
  }
  // Create and store list of beziers for each [potentially] rounded corner
  for (let i = 0; i < n; i++) {
    // allowedCuts[0] is for the side from the previous corner to this one,
    // allowedCuts[1] is for the side from this corner to the next one.
    const allowedCuts: number[] = []
    for (let delta = 0; delta <= 1; delta++) {
      const [roundCutRatio, cutRatio] = cutAdjusts[(i + n - 1 + delta) % n]!
      allowedCuts.push(
        roundedCorners[i]!.expectedRoundCut * roundCutRatio +
          (roundedCorners[i]!.expectedCut -
            roundedCorners[i]!.expectedRoundCut) *
            cutRatio
      )
    }
    corners.push(roundedCorners[i]!.getCubics(allowedCuts[0]!, allowedCuts[1]!))
  }
  // Finally, store the calculated cubics. This includes all of the rounded corners
  // from above, along with new cubics representing the edges between those corners.
  const tempFeatures: Feature[] = []
  for (let i = 0; i < n; i++) {
    // Note that these indices are for pairs of values (points), they need to be
    // doubled to access the xy values in the vertices float array
    const prevVtxIndex = (i + n - 1) % n
    const nextVtxIndex = (i + 1) % n
    const currVertex = new Point(v(i * 2), v(i * 2 + 1))
    const prevVertex = new Point(v(prevVtxIndex * 2), v(prevVtxIndex * 2 + 1))
    const nextVertex = new Point(v(nextVtxIndex * 2), v(nextVtxIndex * 2 + 1))
    const isConvex = convex(prevVertex, currVertex, nextVertex)
    tempFeatures.push(new Corner(corners[i]!, isConvex))
    const cornerLast = corners[i]![corners[i]!.length - 1]!
    const nextCornerFirst = corners[(i + 1) % n]![0]!
    tempFeatures.push(
      new Edge([
        Cubic.straightLine(
          cornerLast.anchor1X,
          cornerLast.anchor1Y,
          nextCornerFirst.anchor0X,
          nextCornerFirst.anchor0Y
        )
      ])
    )
  }

  let cx: number
  let cy: number
  if (centerX === FloatMinValue || centerY === FloatMinValue) {
    const c = calculateCenter(vertices)
    cx = c.x
    cy = c.y
  } else {
    cx = centerX
    cy = centerY
  }
  return fromFeatures(tempFeatures, cx, cy)
}

/** Kotlin's `RoundedPolygon(features, centerX, centerY)`. */
function fromFeatures(
  features: readonly Feature[],
  centerX: number,
  centerY: number
): Resolved {
  if (!(features.length >= 2)) {
    throw new Error('Polygons must have at least 2 features')
  }

  const vertices: number[] = []
  for (const feature of features) {
    for (const cubic of feature.cubics) {
      vertices.push(cubic.anchor0X)
      vertices.push(cubic.anchor0Y)
    }
  }

  const cX = Number.isNaN(centerX) ? calculateCenter(vertices).x : centerX
  const cY = Number.isNaN(centerY) ? calculateCenter(vertices).y : centerY

  return [features, new Point(cX, cY)]
}

/**
 * @internal An estimated center: the average of the given vertices. Only used when the center
 * isn't known or provided.
 */
export function calculateCenter(vertices: Vertices): Point {
  let cumulativeX = 0
  let cumulativeY = 0
  let index = 0
  while (index < vertices.length) {
    cumulativeX += vertices[index++]!
    cumulativeY += vertices[index++]!
  }
  const n = Math.floor(vertices.length / 2)
  return new Point(cumulativeX / n, cumulativeY / n)
}

/**
 * Holds what's needed to round one corner: first the cut it would like to make, then
 * [getCubics] with how much it can actually cut given the space outside the corner. Unrounded
 * corners are a single zero-length cubic at [p1]; rounded ones are a circular arc, flanked by
 * two symmetric smoothing curves when smoothing is nonzero.
 *
 * @param p0 the vertex before the one being rounded
 * @param p1 the vertex of this rounded corner
 * @param p2 the vertex after the one being rounded
 */
class RoundedCorner {
  readonly p0: Point
  readonly p1: Point
  readonly p2: Point
  readonly rounding: CornerRounding | null
  readonly d1: Point
  readonly d2: Point
  readonly cornerRadius: number
  readonly smoothing: number
  readonly cosAngle: number
  readonly sinAngle: number
  readonly expectedRoundCut: number

  // the center of the circle approximated by the rounding curve (or the middle of the three
  // curves if smoothing is requested). The center is the same as p0 if there is no rounding.
  center: Point = new Point(0, 0)

  constructor(
    p0: Point,
    p1: Point,
    p2: Point,
    rounding: CornerRounding | null = null
  ) {
    this.p0 = p0
    this.p1 = p1
    this.p2 = p2
    this.rounding = rounding
    const v01 = p0.minus(p1)
    const v21 = p2.minus(p1)
    const d01 = v01.getDistance()
    const d21 = v21.getDistance()
    if (d01 > 0 && d21 > 0) {
      this.d1 = v01.div(d01)
      this.d2 = v21.div(d21)
      this.cornerRadius = rounding?.radius ?? 0
      this.smoothing = rounding?.smoothing ?? 0

      // cosine of angle at p1 is dot product of unit vectors to the other two vertices
      this.cosAngle = this.d1.dotProduct(this.d2)

      // identity: sin^2 + cos^2 = 1
      // sinAngle gives us the intersection
      this.sinAngle = Math.sqrt(1 - square(this.cosAngle))
      // How much we need to cut, as measured on a side, to get the required radius
      // calculating where the rounding circle hits the edge
      // This uses the identity of tan(A/2) = sinA/(1 + cosA), where tan(A/2) = radius/cut
      this.expectedRoundCut =
        this.sinAngle > 1e-3
          ? (this.cornerRadius * (this.cosAngle + 1)) / this.sinAngle
          : 0
    } else {
      // One (or both) of the sides is empty, not much we can do.
      this.d1 = new Point(0, 0)
      this.d2 = new Point(0, 0)
      this.cornerRadius = 0
      this.smoothing = 0
      this.cosAngle = 0
      this.sinAngle = 0
      this.expectedRoundCut = 0
    }
  }

  // smoothing changes the actual cut. 0 is same as expectedRoundCut, 1 doubles it
  get expectedCut(): number {
    return (1 + this.smoothing) * this.expectedRoundCut
  }

  getCubics(allowedCut0: number, allowedCut1: number = allowedCut0): Cubic[] {
    // We use the minimum of both cuts to determine the radius, but if there is more space
    // in one side we can use it for smoothing.
    const allowedCut = Math.min(allowedCut0, allowedCut1)
    // Nothing to do, just use lines, or a point
    if (
      this.expectedRoundCut < DistanceEpsilon ||
      allowedCut < DistanceEpsilon ||
      this.cornerRadius < DistanceEpsilon
    ) {
      this.center = this.p1
      return [Cubic.straightLine(this.p1.x, this.p1.y, this.p1.x, this.p1.y)]
    }
    // How much of the cut is required for the rounding part.
    const actualRoundCut = Math.min(allowedCut, this.expectedRoundCut)
    // We have two smoothing values, one for each side of the vertex
    // Space is used for rounding values first. If there is space left over, then we
    // apply smoothing, if it was requested
    const actualSmoothing0 = this.calculateActualSmoothingValue(allowedCut0)
    const actualSmoothing1 = this.calculateActualSmoothingValue(allowedCut1)
    // Scale the radius if needed
    const actualR = (this.cornerRadius * actualRoundCut) / this.expectedRoundCut
    // Distance from the corner (p1) to the center
    const centerDistance = Math.sqrt(square(actualR) + square(actualRoundCut))
    // Center of the arc we will use for rounding
    this.center = this.p1.plus(
      this.d1.plus(this.d2).div(2).getDirection().times(centerDistance)
    )
    const circleIntersection0 = this.p1.plus(this.d1.times(actualRoundCut))
    const circleIntersection2 = this.p1.plus(this.d2.times(actualRoundCut))
    const flanking0 = this.computeFlankingCurve(
      actualRoundCut,
      actualSmoothing0,
      this.p1,
      this.p0,
      circleIntersection0,
      circleIntersection2,
      this.center,
      actualR
    )
    const flanking2 = this.computeFlankingCurve(
      actualRoundCut,
      actualSmoothing1,
      this.p1,
      this.p2,
      circleIntersection2,
      circleIntersection0,
      this.center,
      actualR
    ).reverse()
    return [
      flanking0,
      Cubic.circularArc(
        this.center.x,
        this.center.y,
        flanking0.anchor1X,
        flanking0.anchor1Y,
        flanking2.anchor0X,
        flanking2.anchor0Y
      ),
      flanking2
    ]
  }

  /**
   * If allowedCut (the amount we are able to cut) is greater than the expected cut (without
   * smoothing applied yet), then there is room to apply smoothing and we calculate the actual
   * smoothing value here.
   */
  private calculateActualSmoothingValue(allowedCut: number): number {
    if (allowedCut > this.expectedCut) {
      return this.smoothing
    } else if (allowedCut > this.expectedRoundCut) {
      return (
        (this.smoothing * (allowedCut - this.expectedRoundCut)) /
        (this.expectedCut - this.expectedRoundCut)
      )
    } else {
      return 0
    }
  }

  /**
   * A Bezier connecting the linear side (from [sideStart] to [corner]) with the circular segment
   * around [circleCenter] of radius [actualR], starting on the side and ending on the circle.
   * [actualRoundCut] is the cut before smoothing; [actualSmoothingValues] the smoothing, adjusted
   * down if there is not enough room.
   */
  private computeFlankingCurve(
    actualRoundCut: number,
    actualSmoothingValues: number,
    corner: Point,
    sideStart: Point,
    circleSegmentIntersection: Point,
    otherCircleSegmentIntersection: Point,
    circleCenter: Point,
    actualR: number
  ): Cubic {
    // sideStart is the anchor, 'anchor' is actual control point
    const sideDirection = sideStart.minus(corner).getDirection()
    const curveStart = corner.plus(
      sideDirection.times(actualRoundCut).times(1 + actualSmoothingValues)
    )
    // We use an approximation to cut a part of the circle section proportional to 1 - smooth,
    // When smooth = 0, we take the full section, when smooth = 1, we take nothing.
    // TODO: revisit this, it can be problematic as it approaches 180 degrees
    const p = interpolatePoint(
      circleSegmentIntersection,
      circleSegmentIntersection.plus(otherCircleSegmentIntersection).div(2),
      actualSmoothingValues
    )
    // The flanking curve ends on the circle
    const curveEnd = circleCenter.plus(
      directionVector(p.x - circleCenter.x, p.y - circleCenter.y).times(actualR)
    )
    // The anchor on the circle segment side is in the intersection between the tangent to the
    // circle in the circle/flanking curve boundary and the linear segment.
    const circleTangent = curveEnd.minus(circleCenter).rotate90()
    const anchorEnd =
      this.lineIntersection(
        sideStart,
        sideDirection,
        curveEnd,
        circleTangent
      ) ?? circleSegmentIntersection
    // From what remains, we pick a point for the start anchor.
    // 2/3 seems to come from design tools?
    const anchorStart = curveStart.plus(anchorEnd.times(2)).div(3)
    return cubicOf(curveStart, anchorStart, anchorEnd, curveEnd)
  }

  /**
   * Returns the intersection point of the two lines d0->d1 and p0->p1, or null if the lines do
   * not intersect
   */
  private lineIntersection(
    p0: Point,
    d0: Point,
    p1: Point,
    d1: Point
  ): Point | null {
    const rotatedD1 = d1.rotate90()
    const den = d0.dotProduct(rotatedD1)
    if (Math.abs(den) < DistanceEpsilon) return null
    const num = p1.minus(p0).dotProduct(rotatedD1)
    // Also check the relative value. This is equivalent to abs(den/num) < DistanceEpsilon,
    // but avoid doing a division
    if (Math.abs(den) < DistanceEpsilon * Math.abs(num)) return null
    const k = num / den
    return p0.plus(d0.times(k))
  }
}

function verticesFromNumVerts(
  numVertices: number,
  radius: number,
  centerX: number,
  centerY: number
): number[] {
  const result = new Array<number>(numVertices * 2)
  let arrayIndex = 0
  for (let i = 0; i < numVertices; i++) {
    const vertex = radialToCartesian(
      radius,
      (FloatPi / numVertices) * 2 * i
    ).plus(new Point(centerX, centerY))
    result[arrayIndex++] = vertex.x
    result[arrayIndex++] = vertex.y
  }
  return result
}
