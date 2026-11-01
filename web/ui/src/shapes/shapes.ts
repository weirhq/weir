// Ported from androidx graphics-shapes Shapes.kt at commit 1608250 (Apache-2.0).

import { CornerRounding } from './corner-rounding'
import { Point } from './point'
import { RoundedPolygon } from './rounded-polygon'
import { FloatPi, interpolate, radialToCartesian, TwoPi } from './utils'

export interface CircleOptions {
  /** Radius of the circle; default 1. */
  radius?: number
  /** Center of the circle; default (0, 0). */
  centerX?: number
  centerY?: number
}

export interface RectangleOptions {
  /** Default 2. */
  width?: number
  /** Default 2. */
  height?: number
  /** Rounding for every vertex; default [CornerRounding.Unrounded]. */
  rounding?: CornerRounding
  /** Rounding for each of the four corners. */
  perVertexRounding?: readonly CornerRounding[] | null
  /** Default (0, 0). */
  centerX?: number
  centerY?: number
}

export interface StarOptions {
  /** Outer radius, greater than 0; default 1. */
  radius?: number
  /** Inner radius, greater than 0 and less than [radius]; default 0.5. */
  innerRadius?: number
  /** Rounding for every vertex; default [CornerRounding.Unrounded]. */
  rounding?: CornerRounding
  /** Rounding for the inner vertices; if absent they use [rounding] or [perVertexRounding]. */
  innerRounding?: CornerRounding | null
  /** Rounding for each vertex; if given it must have 2 * numVerticesPerRadius elements. */
  perVertexRounding?: readonly CornerRounding[] | null
  /** Default (0, 0). */
  centerX?: number
  centerY?: number
}

export interface PillOptions {
  /** Default 2. */
  width?: number
  /** Default 1. */
  height?: number
  /** Smoothing of the end caps' rounding; default 0. */
  smoothing?: number
  /** Default (0, 0). */
  centerX?: number
  centerY?: number
}

export interface PillStarOptions {
  /** Default 2. */
  width?: number
  /** Default 1. */
  height?: number
  /** Default 8. */
  numVerticesPerRadius?: number
  /** Inner radius as a ratio of the outer, in (0, 1]; default 0.5. */
  innerRadiusRatio?: number
  /** Rounding for every vertex; default [CornerRounding.Unrounded]. */
  rounding?: CornerRounding
  /** Rounding for the inner vertices; if absent they use [rounding] or [perVertexRounding]. */
  innerRounding?: CornerRounding | null
  /** Rounding for each vertex; if given it must have 2 * numVerticesPerRadius elements. */
  perVertexRounding?: readonly CornerRounding[] | null
  /**
   * How vertices are laid out on the circular ends: 0 spaces the inner vertices like those on
   * the straight edges, 1 the outer ones; default 0.5, the average.
   */
  vertexSpacing?: number
  /** Where along the perimeter (0..1) the outline starts; default 0. */
  startLocation?: number
  /** Default (0, 0). */
  centerX?: number
  centerY?: number
}

/**
 * A circle, approximated by rounding the vertices of a [numVertices]-sided polygon (default 8).
 * @throws Error if numVertices < 3
 */
export function circle(
  numVertices = 8,
  options: CircleOptions = {}
): RoundedPolygon {
  const { radius = 1, centerX = 0, centerY = 0 } = options

  if (numVertices < 3) {
    throw new Error('Circle must have at least three vertices')
  }

  // Half of the angle between two adjacent vertices on the polygon
  const theta = FloatPi / numVertices
  // Radius of the underlying RoundedPolygon object given the desired radius of the circle
  const polygonRadius = radius / Math.cos(theta)
  return new RoundedPolygon(numVertices, {
    rounding: new CornerRounding(radius),
    radius: polygonRadius,
    centerX,
    centerY
  })
}

/**
 * A rectangle of the given width and height (default 2x2) around the center, optionally with
 * rounded corners.
 */
export function rectangle(options: RectangleOptions = {}): RoundedPolygon {
  const {
    width = 2,
    height = 2,
    rounding = CornerRounding.Unrounded,
    perVertexRounding = null,
    centerX = 0,
    centerY = 0
  } = options
  const left = centerX - width / 2
  const top = centerY - height / 2
  const right = centerX + width / 2
  const bottom = centerY + height / 2

  return new RoundedPolygon(
    [right, bottom, left, bottom, left, top, right, top],
    { rounding, perVertexRounding, centerX, centerY }
  )
}

/**
 * A star: like a regular polygon except every other vertex is on an inner or outer radius.
 * @throws Error if either radius is <= 0 or innerRadius >= radius
 */
export function star(
  numVerticesPerRadius: number,
  options: StarOptions = {}
): RoundedPolygon {
  const {
    radius = 1,
    innerRadius = 0.5,
    rounding = CornerRounding.Unrounded,
    innerRounding = null,
    perVertexRounding = null,
    centerX = 0,
    centerY = 0
  } = options
  if (radius <= 0 || innerRadius <= 0) {
    throw new Error('Star radii must both be greater than 0')
  }
  if (innerRadius >= radius) {
    throw new Error('innerRadius must be less than radius')
  }

  let pvRounding = perVertexRounding
  // If no per-vertex rounding supplied and caller asked for inner rounding,
  // create per-vertex rounding list based on supplied outer/inner rounding parameters
  if (pvRounding === null && innerRounding !== null) {
    pvRounding = alternate(numVerticesPerRadius, rounding, innerRounding)
  }

  // Star polygon is just a polygon with all vertices supplied (where we generate
  // those vertices to be on the inner/outer radii)
  return new RoundedPolygon(
    starVerticesFromNumVerts(
      numVerticesPerRadius,
      radius,
      innerRadius,
      centerX,
      centerY
    ),
    { rounding, perVertexRounding: pvRounding, centerX, centerY }
  )
}

/**
 * A rectangle bounded by two semicircles at either of the long ends (default 2x1).
 * @throws Error if width or height are <= 0
 */
export function pill(options: PillOptions = {}): RoundedPolygon {
  const {
    width = 2,
    height = 1,
    smoothing = 0,
    centerX = 0,
    centerY = 0
  } = options
  if (!(width > 0 && height > 0)) {
    throw new Error('Pill shapes must have positive width and height')
  }

  const wHalf = width / 2
  const hHalf = height / 2
  return new RoundedPolygon(
    [
      wHalf + centerX,
      hHalf + centerY,
      -wHalf + centerX,
      hHalf + centerY,
      -wHalf + centerX,
      -hHalf + centerY,
      wHalf + centerX,
      -hHalf + centerY
    ],
    {
      rounding: new CornerRounding(Math.min(wHalf, hHalf), smoothing),
      centerX,
      centerY
    }
  )
}

/**
 * Like [pill] but with inner and outer radii along its outline, like a [star] along its circle.
 * On the curved ends, [PillStarOptions.vertexSpacing] decides whether the inner (0) or outer (1)
 * vertices are spaced like those on the straight edges.
 * @throws Error if width or height are <= 0 or innerRadiusRatio is outside (0, 1]
 */
export function pillStar(options: PillStarOptions = {}): RoundedPolygon {
  const {
    width = 2,
    height = 1,
    numVerticesPerRadius = 8,
    innerRadiusRatio = 0.5,
    rounding = CornerRounding.Unrounded,
    innerRounding = null,
    perVertexRounding = null,
    vertexSpacing = 0.5,
    startLocation = 0,
    centerX = 0,
    centerY = 0
  } = options
  if (!(width > 0 && height > 0)) {
    throw new Error('Pill shapes must have positive width and height')
  }
  if (!(innerRadiusRatio > 0 && innerRadiusRatio <= 1)) {
    throw new Error('innerRadius must be between 0 and 1')
  }

  let pvRounding = perVertexRounding
  // If no per-vertex rounding supplied and caller asked for inner rounding,
  // create per-vertex rounding list based on supplied outer/inner rounding parameters
  if (pvRounding === null && innerRounding !== null) {
    pvRounding = alternate(numVerticesPerRadius, rounding, innerRounding)
  }
  return new RoundedPolygon(
    pillStarVerticesFromNumVerts(
      numVerticesPerRadius,
      width,
      height,
      innerRadiusRatio,
      vertexSpacing,
      startLocation,
      centerX,
      centerY
    ),
    { rounding, perVertexRounding: pvRounding, centerX, centerY }
  )
}

/** `(0 until n).flatMap { listOf(rounding, innerRounding) }` */
function alternate(
  n: number,
  rounding: CornerRounding,
  innerRounding: CornerRounding
): CornerRounding[] {
  const result: CornerRounding[] = []
  for (let i = 0; i < n; i++) result.push(rounding, innerRounding)
  return result
}

function pillStarVerticesFromNumVerts(
  numVerticesPerRadius: number,
  width: number,
  height: number,
  innerRadius: number,
  vertexSpacing: number,
  startLocation: number,
  centerX: number,
  centerY: number
): number[] {
  // The general approach here is to get the perimeter of the underlying pill outline,
  // then the t value for each vertex as we walk that perimeter. This tells us where
  // on the outline to place that vertex, then we figure out where to place the vertex
  // depending on which "section" it is in. The possible sections are the vertical edges
  // on the sides, the circular sections on all four corners, or the horizontal edges
  // on the top and bottom. Note that either the vertical or horizontal edges will be
  // of length zero (whichever dimension is smaller gets only circular curvature for the
  // pill shape).
  const endcapRadius = Math.min(width, height)
  const vSegLen = Math.max(height - width, 0)
  const hSegLen = Math.max(width - height, 0)
  const vSegHalf = vSegLen / 2
  const hSegHalf = hSegLen / 2
  // vertexSpacing is used to position the vertices on the end caps. The caller has the choice
  // of spacing the inner (0) or outer (1) vertices like those along the edges, causing the
  // other vertices to be either further apart (0) or closer (1). The default is .5, which
  // averages things. The magnitude of the inner and rounding parameters may cause the caller
  // to want a different value.
  const circlePerimeter =
    TwoPi * endcapRadius * interpolate(innerRadius, 1, vertexSpacing)
  // perimeter is circle perimeter plus horizontal and vertical sections of inner rectangle,
  // whether either (or even both) might be of length zero.
  const perimeter = 2 * hSegLen + 2 * vSegLen + circlePerimeter

  // The sections array holds the t start values of that part of the outline. We use these to
  // determine which section a given vertex lies in, based on its t value, as well as where
  // in that section it lies.
  const sections = new Array<number>(11).fill(0)
  sections[0] = 0
  sections[1] = vSegLen / 2
  sections[2] = sections[1] + circlePerimeter / 4
  sections[3] = sections[2] + hSegLen
  sections[4] = sections[3] + circlePerimeter / 4
  sections[5] = sections[4] + vSegLen
  sections[6] = sections[5] + circlePerimeter / 4
  sections[7] = sections[6] + hSegLen
  sections[8] = sections[7] + circlePerimeter / 4
  sections[9] = sections[8] + vSegLen / 2
  sections[10] = perimeter
  const section = (i: number) => sections[i]!

  // "t" is the length along the entire pill outline for a given vertex. With vertices spaced
  // evenly along this contour, we can determine for any vertex where it should lie.
  const tPerVertex = perimeter / (2 * numVerticesPerRadius)
  // separate iteration for inner vs outer, unlike the other shapes, because
  // the vertices can lie in different quadrants so each needs their own calculation
  let inner = false
  // Increment section index as we walk around the pill contour with our increasing t values
  let currSecIndex = 0
  // secStart/End are used to determine how far along a given vertex is in the section
  // in which it lands
  let secStart = 0
  let secEnd = section(1)
  // t value is used to place each vertex. 0 is on the positive x axis,
  // moving into section 0 to begin with. startLocation, a value from 0 to 1, varies the location
  // anywhere on the perimeter of the shape
  let t = startLocation * perimeter
  // The list of vertices to be returned
  const result = new Array<number>(numVerticesPerRadius * 4)
  let arrayIndex = 0
  const rectBR = new Point(hSegHalf, vSegHalf)
  const rectBL = new Point(-hSegHalf, vSegHalf)
  const rectTL = new Point(-hSegHalf, -vSegHalf)
  const rectTR = new Point(hSegHalf, -vSegHalf)
  // Each iteration through this loop uses the next t value as we walk around the shape
  for (let i = 0; i < numVerticesPerRadius * 2; i++) {
    // t could start (and end) after 0; extra boundedT logic makes sure it does the right
    // thing when crossing the boundar past 0 again
    const boundedT = t % perimeter
    if (boundedT < secStart) currSecIndex = 0
    while (boundedT >= section((currSecIndex + 1) % sections.length)) {
      currSecIndex = (currSecIndex + 1) % sections.length
      secStart = section(currSecIndex)
      secEnd = section((currSecIndex + 1) % sections.length)
    }

    // find t in section and its proportion of that section's total length
    const tInSection = boundedT - secStart
    const tProportion = tInSection / (secEnd - secStart)

    // The vertex placement in a section varies depending on whether it is on one of the
    // semicircle endcaps or along one of the straight edges. For the endcaps, we use
    // tProportion to get the angle along that circular cap and add
    // the starting angle for that section. For the edges we use a straight linear calculation
    // given tProportion and the start/end t values for that edge.
    const currRadius = inner ? endcapRadius * innerRadius : endcapRadius
    let vertex: Point
    switch (currSecIndex) {
      case 0:
        vertex = new Point(currRadius, tProportion * vSegHalf)
        break
      case 1:
        vertex = radialToCartesian(
          currRadius,
          (tProportion * FloatPi) / 2
        ).plus(rectBR)
        break
      case 2:
        vertex = new Point(hSegHalf - tProportion * hSegLen, currRadius)
        break
      case 3:
        vertex = radialToCartesian(
          currRadius,
          FloatPi / 2 + (tProportion * FloatPi) / 2
        ).plus(rectBL)
        break
      case 4:
        vertex = new Point(-currRadius, vSegHalf - tProportion * vSegLen)
        break
      case 5:
        vertex = radialToCartesian(
          currRadius,
          FloatPi + (tProportion * FloatPi) / 2
        ).plus(rectTL)
        break
      case 6:
        vertex = new Point(-hSegHalf + tProportion * hSegLen, -currRadius)
        break
      case 7:
        vertex = radialToCartesian(
          currRadius,
          FloatPi * 1.5 + (tProportion * FloatPi) / 2
        ).plus(rectTR)
        break
      // 8
      default:
        vertex = new Point(currRadius, -vSegHalf + tProportion * vSegHalf)
    }
    result[arrayIndex++] = vertex.x + centerX
    result[arrayIndex++] = vertex.y + centerY
    t += tPerVertex
    inner = !inner
  }
  return result
}

function starVerticesFromNumVerts(
  numVerticesPerRadius: number,
  radius: number,
  innerRadius: number,
  centerX: number,
  centerY: number
): number[] {
  const result = new Array<number>(numVerticesPerRadius * 4)
  let arrayIndex = 0
  for (let i = 0; i < numVerticesPerRadius; i++) {
    let vertex = radialToCartesian(
      radius,
      (FloatPi / numVerticesPerRadius) * 2 * i
    )
    result[arrayIndex++] = vertex.x + centerX
    result[arrayIndex++] = vertex.y + centerY
    vertex = radialToCartesian(
      innerRadius,
      (FloatPi / numVerticesPerRadius) * (2 * i + 1)
    )
    result[arrayIndex++] = vertex.x + centerX
    result[arrayIndex++] = vertex.y + centerY
  }
  return result
}
