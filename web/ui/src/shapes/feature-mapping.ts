// Ported from androidx graphics-shapes FeatureMapping.kt at commit 1608250 (Apache-2.0).

import { Corner, type Feature } from './features'
import {
  DoubleMapper,
  progressDistance,
  progressInRange
} from './float-mapping'
import { Point } from './point'
import { DistanceEpsilon, FloatMaxValue } from './utils'

/** A feature in a polygon along with the [0..1] outline progress at that feature. */
export class ProgressableFeature {
  readonly progress: number
  readonly feature: Feature

  constructor(progress: number, feature: Feature) {
    this.progress = progress
    this.feature = feature
  }
}

/** All features in a polygon along with the progress at each. */
export type MeasuredFeatures = readonly ProgressableFeature[]

/** Creates a mapping between the "features" (rounded corners) of two shapes. */
export function featureMapper(
  features1: MeasuredFeatures,
  features2: MeasuredFeatures
): DoubleMapper {
  // We only use corners for this mapping.
  const filteredFeatures1: ProgressableFeature[] = []
  for (let i = 0; i < features1.length; i++) {
    if (features1[i]!.feature instanceof Corner) {
      filteredFeatures1.push(features1[i]!)
    }
  }
  const filteredFeatures2: ProgressableFeature[] = []
  for (let i = 0; i < features2.length; i++) {
    if (features2[i]!.feature instanceof Corner) {
      filteredFeatures2.push(features2[i]!)
    }
  }

  const featureProgressMapping = doMapping(filteredFeatures1, filteredFeatures2)
  return new DoubleMapper(...featureProgressMapping)
}

interface DistanceVertex {
  distance: number
  f1: ProgressableFeature
  f2: ProgressableFeature
}

/**
 * Maps features1 to features2, returning (progress in features1, progress in features2) pairs
 * sorted by the first element:
 * 1) Compute the distance for all pairs of features in (features1 x features2),
 * 2) Sort ascending by such distance
 * 3) Add them from smallest distance to biggest, skipping features already mapped and mappings
 *    that would add a crossing (the second elements must increase monotonically, except maybe
 *    once, counting the last-to-first pair too).
 */
export function doMapping(
  features1: readonly ProgressableFeature[],
  features2: readonly ProgressableFeature[]
): [number, number][] {
  const distanceVertexList: DistanceVertex[] = []
  for (const f1 of features1) {
    for (const f2 of features2) {
      const d = featureDistSquared(f1.feature, f2.feature)
      if (d !== FloatMaxValue) distanceVertexList.push({ distance: d, f1, f2 })
    }
  }
  // Array.prototype.sort is stable, like Kotlin's sortedBy.
  distanceVertexList.sort((a, b) => a.distance - b.distance)

  // Special cases.
  if (distanceVertexList.length === 0) return identityMapping()
  if (distanceVertexList.length === 1) {
    const it = distanceVertexList[0]!
    const f1 = it.f1.progress
    const f2 = it.f2.progress
    return [
      [f1, f2],
      [(f1 + 0.5) % 1, (f2 + 0.5) % 1]
    ]
  }

  const helper = new MappingHelper()
  for (const it of distanceVertexList) helper.addMapping(it.f1, it.f2)
  return helper.mapping
}

function identityMapping(): [number, number][] {
  return [
    [0, 0],
    [0.5, 0.5]
  ]
}

/** Kotlin's `binarySearchBy` over the first element: index, or -(insertion point) - 1. */
function binarySearchByFirst(list: [number, number][], key: number): number {
  let low = 0
  let high = list.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    const midVal = list[mid]![0]
    if (midVal < key) low = mid + 1
    else if (midVal > key) high = mid - 1
    else return mid
  }
  return -(low + 1)
}

class MappingHelper {
  // List of mappings from progress in the start shape to progress in the end shape.
  // We keep this list sorted by the first element.
  readonly mapping: [number, number][] = []

  // Which features in the start shape have we used and which in the end shape.
  private readonly usedF1 = new Set<ProgressableFeature>()
  private readonly usedF2 = new Set<ProgressableFeature>()

  addMapping(f1: ProgressableFeature, f2: ProgressableFeature): void {
    // We don't want to map the same feature twice.
    if (this.usedF1.has(f1) || this.usedF2.has(f2)) return

    // Ret is sorted, find where we need to insert this new mapping.
    const index = binarySearchByFirst(this.mapping, f1.progress)
    if (!(index < 0)) {
      throw new Error("There can't be two features with the same progress")
    }

    const insertionIndex = -index - 1
    const n = this.mapping.length

    // We can always add the first 1 element
    if (n >= 1) {
      const [before1, before2] = this.mapping[(insertionIndex + n - 1) % n]!
      const [after1, after2] = this.mapping[insertionIndex % n]!

      // We don't want features that are way too close to each other, that will make the
      // DoubleMapper unstable
      if (
        progressDistance(f1.progress, before1) < DistanceEpsilon ||
        progressDistance(f1.progress, after1) < DistanceEpsilon ||
        progressDistance(f2.progress, before2) < DistanceEpsilon ||
        progressDistance(f2.progress, after2) < DistanceEpsilon
      ) {
        return
      }

      // When we have 2 or more elements, we need to ensure we are not adding extra crossings.
      if (n > 1 && !progressInRange(f2.progress, before2, after2)) return
    }

    // All good, we can add the mapping.
    this.mapping.splice(insertionIndex, 0, [f1.progress, f2.progress])
    this.usedF1.add(f1)
    this.usedF2.add(f2)
  }
}

/**
 * Returns distance along overall shape between two Features on the two different shapes, used
 * to determine how to map features (and the curves that make up those features).
 */
export function featureDistSquared(f1: Feature, f2: Feature): number {
  // TODO: We might want to enable concave-convex matching in some situations. If so, the
  //  approach below will not work
  if (f1 instanceof Corner && f2 instanceof Corner && f1.convex !== f2.convex) {
    // Simple hack to force all features to map only to features of the same concavity, by
    // returning an infinitely large distance in that case
    return FloatMaxValue
  }
  return featureRepresentativePoint(f1)
    .minus(featureRepresentativePoint(f2))
    .getDistanceSquared()
}

// TODO: b/378441547 - Move to explicit parameter / expose?
export function featureRepresentativePoint(feature: Feature): Point {
  const first = feature.cubics[0]!
  const last = feature.cubics[feature.cubics.length - 1]!
  const x = (first.anchor0X + last.anchor1X) / 2
  const y = (first.anchor0Y + last.anchor1Y) / 2
  return new Point(x, y)
}
