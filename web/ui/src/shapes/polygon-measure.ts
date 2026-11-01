// Ported from androidx graphics-shapes PolygonMeasure.kt at commit 1608250 (Apache-2.0).

import type { Cubic } from './cubic'
import { ProgressableFeature } from './feature-mapping'
import { Corner, type Feature } from './features'
import { Point } from './point'
import type { RoundedPolygon } from './rounded-polygon'
import { DistanceEpsilon, positiveModulo } from './utils'

/**
 * Holds a cubic and the outline progress values (start and end) it spans. Outline progress is a
 * value in [0..1) that represents the distance traveled along the overall outline of the shape;
 * cubics at similar outline progress are matched between shapes (after matching features and
 * shifting).
 */
export class MeasuredCubic {
  readonly cubic: Cubic
  readonly measuredSize: number
  private readonly measurer: Measurer
  private _startOutlineProgress: number
  private _endOutlineProgress: number

  constructor(
    measurer: Measurer,
    cubic: Cubic,
    startOutlineProgress: number,
    endOutlineProgress: number
  ) {
    if (!(endOutlineProgress >= startOutlineProgress)) {
      throw new Error(
        'endOutlineProgress is expected to be equal or greater than startOutlineProgress'
      )
    }
    this.measurer = measurer
    this.cubic = cubic
    this._startOutlineProgress = startOutlineProgress
    this._endOutlineProgress = endOutlineProgress
    this.measuredSize = measurer.measureCubic(cubic)
  }

  get startOutlineProgress(): number {
    return this._startOutlineProgress
  }

  get endOutlineProgress(): number {
    return this._endOutlineProgress
  }

  updateProgressRange(
    startOutlineProgress: number = this._startOutlineProgress,
    endOutlineProgress: number = this._endOutlineProgress
  ): void {
    if (!(endOutlineProgress >= startOutlineProgress)) {
      throw new Error(
        'endOutlineProgress is expected to be equal or greater than startOutlineProgress'
      )
    }
    this._startOutlineProgress = startOutlineProgress
    this._endOutlineProgress = endOutlineProgress
  }

  /** Cut this MeasuredCubic into two MeasuredCubics at the given outline progress value. */
  cutAtProgress(cutOutlineProgress: number): [MeasuredCubic, MeasuredCubic] {
    // Floating point errors further up can cause cutOutlineProgress to land just
    // slightly outside of the start/end progress for this cubic, so we limit it
    // to those bounds to avoid further errors later
    const start = this._startOutlineProgress
    const end = this._endOutlineProgress
    const boundedCutOutlineProgress =
      cutOutlineProgress < start
        ? start
        : cutOutlineProgress > end
          ? end
          : cutOutlineProgress
    const outlineProgressSize = end - start
    const progressFromStart = boundedCutOutlineProgress - start

    // Note that in earlier parts of the computation, we have empty MeasuredCubics (cubics
    // with progressSize == 0f), but those cubics are filtered out before this method is
    // called.
    const relativeProgress = progressFromStart / outlineProgressSize
    const t = this.measurer.findCubicCutPoint(
      this.cubic,
      relativeProgress * this.measuredSize
    )
    if (!(t >= 0 && t <= 1)) {
      throw new Error('Cubic cut point is expected to be between 0 and 1')
    }

    // c1/c2 are the two new cubics, then we return MeasuredCubics created from them
    const [c1, c2] = this.cubic.split(t)
    return [
      new MeasuredCubic(this.measurer, c1, start, boundedCutOutlineProgress),
      new MeasuredCubic(this.measurer, c2, boundedCutOutlineProgress, end)
    ]
  }

  toString(): string {
    return (
      'MeasuredCubic(outlineProgress=' +
      `[${this._startOutlineProgress} .. ${this._endOutlineProgress}], ` +
      `size=${this.measuredSize}, cubic=${this.cubic})`
    )
  }
}

export class MeasuredPolygon {
  private readonly measurer: Measurer
  private readonly cubics: MeasuredCubic[]
  readonly features: readonly ProgressableFeature[]

  private constructor(
    measurer: Measurer,
    features: readonly ProgressableFeature[],
    cubics: readonly Cubic[],
    outlineProgress: readonly number[]
  ) {
    if (outlineProgress.length !== cubics.length + 1) {
      throw new Error(
        'Outline progress size is expected to be the cubics size + 1'
      )
    }
    if (outlineProgress[0] !== 0) {
      throw new Error('First outline progress value is expected to be zero')
    }
    if (outlineProgress[outlineProgress.length - 1] !== 1) {
      throw new Error('Last outline progress value is expected to be one')
    }
    this.measurer = measurer
    this.features = features

    const measuredCubics: MeasuredCubic[] = []
    let startOutlineProgress = 0
    for (let index = 0; index < cubics.length; index++) {
      // Filter out "empty" cubics
      if (
        outlineProgress[index + 1]! - outlineProgress[index]! >
        DistanceEpsilon
      ) {
        measuredCubics.push(
          new MeasuredCubic(
            measurer,
            cubics[index]!,
            startOutlineProgress,
            outlineProgress[index + 1]!
          )
        )
        // The next measured cubic will start exactly where this one ends.
        startOutlineProgress = outlineProgress[index + 1]!
      }
    }
    // We could have removed empty cubics at the end. Ensure the last measured cubic ends at 1f
    const last = measuredCubics[measuredCubics.length - 1]
    if (last === undefined)
      throw new Error('Index -1 out of bounds for length 0')
    last.updateProgressRange(undefined, 1)
    this.cubics = measuredCubics
  }

  /**
   * Finds the measured cubic that passes [cuttingPoint] and returns an equivalent MeasuredPolygon
   * that starts there, cutting that cubic unless the cut is at one of its ends. E.g. cutting
   * c1 [0 -> 0.2] c2 [0.2 -> 0.5] c3 [0.5 -> 1.0] at 0.4 cuts c2 into c2a [0.2 -> 0.4] and
   * c2b [0.4 -> 0.5] and returns c2b [0 -> 0.1] c3 [0.1 -> 0.6] c1 [0.6 -> 0.8] c2a [0.8 -> 1.0].
   */
  cutAndShift(cuttingPoint: number): MeasuredPolygon {
    if (!(cuttingPoint >= 0 && cuttingPoint <= 1)) {
      throw new Error('Cutting point is expected to be between 0 and 1')
    }
    if (cuttingPoint < DistanceEpsilon) return this

    // Find the index of cubic we want to cut
    const targetIndex = this.cubics.findIndex(
      (it) =>
        cuttingPoint >= it.startOutlineProgress &&
        cuttingPoint <= it.endOutlineProgress
    )
    const target = this.cubics[targetIndex]
    if (target === undefined) {
      throw new Error(
        `Index ${targetIndex} out of bounds for length ${this.cubics.length}`
      )
    }
    // Cut the target cubic.
    // b1, b2 are two resulting cubics after cut
    const [b1, b2] = target.cutAtProgress(cuttingPoint)

    // Construct the list of the cubics we need:
    // * The second part of the target cubic (after the cut)
    // * All cubics after the target, until the end + All cubics from the start, before the
    //   target cubic
    // * The first part of the target cubic (before the cut)
    const size = this.cubics.length
    const retCubics: Cubic[] = [b2.cubic]
    for (let i = 1; i < size; i++) {
      retCubics.push(this.cubics[(i + targetIndex) % size]!.cubic)
    }
    retCubics.push(b1.cubic)

    // Construct the array of outline progress.
    // For example, if we have 3 cubics with outline progress [0 .. 0.3], [0.3 .. 0.8] &
    // [0.8 .. 1.0], and we cut + shift at 0.6:
    // 0.  0123456789
    //     |--|--/-|-|
    // The outline progresses will start at 0 (the cutting point, that shifs to 0.0),
    // then 0.8 - 0.6 = 0.2, then 1 - 0.6 = 0.4, then 0.3 - 0.6 + 1 = 0.7,
    // then 1 (the cutting point again),
    // all together: (0.0, 0.2, 0.4, 0.7, 1.0)
    const retOutlineProgress: number[] = []
    for (let index = 0; index < size + 2; index++) {
      if (index === 0) {
        retOutlineProgress.push(0)
      } else if (index === size + 1) {
        retOutlineProgress.push(1)
      } else {
        const cubicIndex = (targetIndex + index - 1) % size
        retOutlineProgress.push(
          positiveModulo(
            this.cubics[cubicIndex]!.endOutlineProgress - cuttingPoint,
            1
          )
        )
      }
    }

    // Shift the feature's outline progress too.
    const newFeatures: ProgressableFeature[] = []
    for (let i = 0; i < this.features.length; i++) {
      newFeatures.push(
        new ProgressableFeature(
          positiveModulo(this.features[i]!.progress - cuttingPoint, 1),
          this.features[i]!.feature
        )
      )
    }

    // Filter out all empty cubics (i.e. start and end anchor are (almost) the same point.)
    return new MeasuredPolygon(
      this.measurer,
      newFeatures,
      retCubics,
      retOutlineProgress
    )
  }

  // Implementation of AbstractList.
  get size(): number {
    return this.cubics.length
  }

  get(index: number): MeasuredCubic {
    const cubic = this.cubics[index]
    if (cubic === undefined) {
      throw new Error(
        `Index ${index} out of bounds for length ${this.cubics.length}`
      )
    }
    return cubic
  }

  getOrNull(index: number): MeasuredCubic | null {
    return this.cubics[index] ?? null
  }

  static measurePolygon(
    measurer: Measurer,
    polygon: RoundedPolygon
  ): MeasuredPolygon {
    const cubics: Cubic[] = []
    const featureToCubic: [Feature, number][] = []

    // Get the cubics from the polygon, at the same time, extract the features and keep a
    // reference to the representative cubic we will use.
    for (
      let featureIndex = 0;
      featureIndex < polygon.features.length;
      featureIndex++
    ) {
      const feature = polygon.features[featureIndex]!
      for (
        let cubicIndex = 0;
        cubicIndex < feature.cubics.length;
        cubicIndex++
      ) {
        if (
          feature instanceof Corner &&
          cubicIndex === Math.floor(feature.cubics.length / 2)
        ) {
          featureToCubic.push([feature, cubics.length])
        }
        cubics.push(feature.cubics[cubicIndex]!)
      }
    }
    const measures: number[] = [0]
    for (const cubic of cubics) {
      const it = measurer.measureCubic(cubic)
      if (!(it >= 0)) {
        throw new Error(
          'Measured cubic is expected to be greater or equal to zero'
        )
      }
      measures.push(measures[measures.length - 1]! + it)
    }
    const totalMeasure = measures[measures.length - 1]!

    const outlineProgress: number[] = []
    for (let i = 0; i < measures.length; i++) {
      outlineProgress.push(measures[i]! / totalMeasure)
    }

    const features: ProgressableFeature[] = []
    for (let i = 0; i < featureToCubic.length; i++) {
      const ix = featureToCubic[i]![1]
      features.push(
        new ProgressableFeature(
          positiveModulo(
            (outlineProgress[ix]! + outlineProgress[ix + 1]!) / 2,
            1
          ),
          featureToCubic[i]![0]
        )
      )
    }

    return new MeasuredPolygon(measurer, features, cubics, outlineProgress)
  }
}

/** Measures a cubic, by whatever measure the implementation chooses (angle, length, etc). */
export interface Measurer {
  /** Size of the given cubic; has to be greater or equal to 0. */
  measureCubic(c: Cubic): number

  /**
   * Given a measure between 0 and [measureCubic] (capped if not), finds the parameter t of the
   * cubic at which that measure is reached.
   */
  findCubicCutPoint(c: Cubic, m: number): number
}

/**
 * Approximates the arc lengths of cubics by splitting the arc into segments and summing their
 * sizes. The default has at least 98.5% accuracy on a circular arc, the worst case for our
 * standard shapes.
 */
export class LengthMeasurer implements Measurer {
  // The minimum number needed to achieve up to 98.5% accuracy from the true arc length
  // See PolygonMeasureTest.measureCircle
  private readonly segments = 3

  measureCubic(c: Cubic): number {
    return this.closestProgressTo(c, Number.POSITIVE_INFINITY)[1]
  }

  findCubicCutPoint(c: Cubic, m: number): number {
    return this.closestProgressTo(c, m)[0]
  }

  private closestProgressTo(cubic: Cubic, threshold: number): [number, number] {
    let total = 0
    let remainder = threshold
    let prev = new Point(cubic.anchor0X, cubic.anchor0Y)

    for (let i = 1; i <= this.segments; i++) {
      const progress = i / this.segments
      const point = cubic.pointOnCurve(progress)
      const segment = point.minus(prev).getDistance()

      if (segment >= remainder) {
        return [
          progress - (1.0 - remainder / segment) / this.segments,
          threshold
        ]
      }

      remainder -= segment
      total += segment
      prev = point
    }

    return [1.0, total]
  }
}
