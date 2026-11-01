// Ported from androidx graphics-shapes Features.kt at commit 1608250 (Apache-2.0).

import type { Cubic, PointTransformer } from './cubic'
import { DistanceEpsilon } from './utils'

// TODO: b/374764251 Introduce an IgnorableFeature?

/**
 * Groups cubics into (straight) edges, convex corners or concave corners. [Morph] uses the
 * grouping to reduce noise, as the base set for its mapping, and to map convex corners to convex
 * corners and concave to concave; ignorable features (edges) are left out of that mapping.
 */
export abstract class Feature {
  readonly cubics: readonly Cubic[]

  constructor(cubics: readonly Cubic[]) {
    this.cubics = cubics
  }

  /**
   * Groups [cubics] into a feature that the default [Morph] mapping ignores.
   * @throws Error for empty or non-continuous cubics
   */
  static buildIgnorableFeature(cubics: readonly Cubic[]): Feature {
    return validated(new Edge(cubics))
  }

  /** Groups a [Cubic] into an edge (neither inward nor outward). */
  static buildEdge(cubic: Cubic): Feature {
    return new Edge([cubic])
  }

  /**
   * Groups [cubics] into a convex corner (outward indentation in a shape).
   * @throws Error for empty or non-continuous cubics
   */
  static buildConvexCorner(cubics: readonly Cubic[]): Feature {
    return validated(new Corner(cubics, true))
  }

  /**
   * Groups [cubics] into a concave corner (inward indentation in a shape).
   * @throws Error for empty or non-continuous cubics
   */
  static buildConcaveCorner(cubics: readonly Cubic[]): Feature {
    return validated(new Corner(cubics, false))
  }

  /** Transforms the points in this [Feature] with [f] and returns a new [Feature]. */
  abstract transformed(f: PointTransformer): Feature

  /** Returns a new [Feature] with its points in reversed order. */
  abstract reversed(): Feature

  /** Whether this Feature gets ignored in the Morph mapping. */
  abstract readonly isIgnorableFeature: boolean

  /** Whether this Feature is an Edge with no inward or outward indentation. */
  abstract readonly isEdge: boolean

  /** Whether this Feature is a convex corner (outward indentation in a shape). */
  abstract readonly isConvexCorner: boolean

  /** Whether this Feature is a concave corner (inward indentation in a shape). */
  abstract readonly isConcaveCorner: boolean
}

function validated(feature: Feature): Feature {
  if (feature.cubics.length === 0) {
    throw new Error('Features need at least one cubic.')
  }
  if (!isContinuous(feature)) {
    throw new Error(
      'Feature must be continuous, with the anchor points of all cubics ' +
        'matching the anchor points of the preceding and succeeding cubics'
    )
  }
  return feature
}

function isContinuous(feature: Feature): boolean {
  let prevCubic = feature.cubics[0]!
  for (let index = 1; index < feature.cubics.length; index++) {
    const cubic = feature.cubics[index]!
    if (
      Math.abs(cubic.anchor0X - prevCubic.anchor1X) > DistanceEpsilon ||
      Math.abs(cubic.anchor0Y - prevCubic.anchor1Y) > DistanceEpsilon
    ) {
      return false
    }
    prevCubic = cubic
  }
  return true
}

function transformCubics(
  cubics: readonly Cubic[],
  f: PointTransformer
): Cubic[] {
  const result: Cubic[] = []
  for (let i = 0; i < cubics.length; i++) result.push(cubics[i]!.transformed(f))
  return result
}

function reverseCubics(cubics: readonly Cubic[]): Cubic[] {
  const result: Cubic[] = []
  for (let i = cubics.length - 1; i >= 0; i--) result.push(cubics[i]!.reverse())
  return result
}

/**
 * @internal Edges lie between corners and have no vertex or concavity; the curves are simply
 * straight lines (represented by Cubic curves).
 */
export class Edge extends Feature {
  readonly isIgnorableFeature = true
  readonly isEdge = true
  readonly isConvexCorner = false
  readonly isConcaveCorner = false

  transformed(f: PointTransformer): Edge {
    return new Edge(transformCubics(this.cubics, f))
  }

  reversed(): Edge {
    return new Edge(reverseCubics(this.cubics))
  }

  override toString(): string {
    return 'Edge'
  }
}

/**
 * @internal Corners hold the cubics that describe how the corner is rounded (or not), and whether
 * it is convex. A star generally has both convex (outer) and concave (inner) corners.
 */
export class Corner extends Feature {
  readonly convex: boolean
  readonly isIgnorableFeature = false
  readonly isEdge = false

  constructor(cubics: readonly Cubic[], convex = true) {
    super(cubics)
    this.convex = convex
  }

  get isConvexCorner(): boolean {
    return this.convex
  }

  get isConcaveCorner(): boolean {
    return !this.convex
  }

  transformed(f: PointTransformer): Corner {
    return new Corner(transformCubics(this.cubics, f), this.convex)
  }

  reversed(): Corner {
    // TODO: b/369320447 - Revert flag negation when [RoundedPolygon] ignores orientation
    // for setting the flag
    return new Corner(reverseCubics(this.cubics), !this.convex)
  }

  override toString(): string {
    return `Corner: cubics=${this.cubics.map((c) => `[${c}]`).join(', ')} convex=${this.convex}`
  }
}
