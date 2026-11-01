// Ported from androidx graphics-shapes FloatMapping.kt at commit 1608250 (Apache-2.0).

import { DistanceEpsilon, positiveModulo } from './utils'

/**
 * Whether [progress] is in the given progress range. Progress is in [0..1) and wraps, so when
 * progressTo < progressFrom, e.g. 0.7 to 0.2, both 0.8 and 0.1 are inside and 0.5 is outside.
 */
export function progressInRange(
  progress: number,
  progressFrom: number,
  progressTo: number
): boolean {
  return progressTo >= progressFrom
    ? progress >= progressFrom && progress <= progressTo
    : progress >= progressFrom || progress <= progressTo
}

/**
 * Maps from one set of progress values to another. This is used by DoubleMapper to retrieve the
 * value on one shape that maps to the appropriate value on the other.
 */
export function linearMap(
  xValues: readonly number[],
  yValues: readonly number[],
  x: number
): number {
  if (!(x >= 0 && x <= 1)) throw new Error(`Invalid progress: ${x}`)
  let segmentStartIndex = -1
  for (let it = 0; it < xValues.length; it++) {
    if (progressInRange(x, xValues[it]!, xValues[(it + 1) % xValues.length]!)) {
      segmentStartIndex = it
      break
    }
  }
  if (segmentStartIndex < 0) {
    throw new Error('Collection contains no element matching the predicate.')
  }
  const segmentEndIndex = (segmentStartIndex + 1) % xValues.length
  const segmentSizeX = positiveModulo(
    xValues[segmentEndIndex]! - xValues[segmentStartIndex]!,
    1
  )
  const segmentSizeY = positiveModulo(
    yValues[segmentEndIndex]! - yValues[segmentStartIndex]!,
    1
  )
  const positionInSegment =
    segmentSizeX < 0.001
      ? 0.5
      : positiveModulo(x - xValues[segmentStartIndex]!, 1) / segmentSizeX
  return positiveModulo(
    yValues[segmentStartIndex]! + segmentSizeY * positionInSegment,
    1
  )
}

/**
 * Maps values in the [0..1) source space to the [0..1) target space and back, given a finite list
 * of representative mappings, extended to the whole interval by linear interpolation and
 * wrapping around. With mappings 0.2 to 0.5 and 0.4 to 0.6, 0.3 maps to 0.55 and 0.21 to 0.505.
 * Used to map progress values between the start and end shape of a morph.
 */
export class DoubleMapper {
  private readonly sourceValues: number[] = []
  private readonly targetValues: number[] = []

  static readonly Identity = new DoubleMapper(
    // We need any 2 points in the (x, x) diagonal, with x in the [0, 1) range,
    // We spread them as much as possible to minimize float errors.
    [0, 0],
    [0.5, 0.5]
  )

  constructor(...mappings: (readonly [number, number])[]) {
    for (let i = 0; i < mappings.length; i++) {
      this.sourceValues.push(mappings[i]![0])
      this.targetValues.push(mappings[i]![1])
    }
    // Both source values and target values should be monotonically increasing, with the
    // exception of maybe one time (since progress wraps around).
    validateProgress(this.sourceValues)
    validateProgress(this.targetValues)
  }

  map(x: number): number {
    return linearMap(this.sourceValues, this.targetValues, x)
  }

  mapBack(x: number): number {
    return linearMap(this.targetValues, this.sourceValues, x)
  }
}

// Verify that a list of progress values are all in the range [0.0, 1.0) and is monotonically
// increasing, with the exception of maybe one time in which the progress wraps around, this check
// needs to include all pairs of consecutive elements in the list plus the last to first element
// pair.
// For example: (0.0, 0.3, 0.6) is a valid list, so are (0.3, 0.6, 0.0) and (0.6, 0.3, 0.0).
// On the other hand, something like (0.5, 0.0, 0.7) is not (since it goes down twice, from 0.5 to
// 0.0 and then from to 0.7 to 0.5).
export function validateProgress(p: readonly number[]): void {
  if (p.length === 0) throw new Error('List is empty.')
  let prev = p[p.length - 1]!
  let wraps = 0
  for (let i = 0; i < p.length; i++) {
    const curr = p[i]!
    if (!(curr >= 0 && curr < 1)) {
      throw new Error(
        'FloatMapping - Progress outside of range: ' + p.join(', ')
      )
    }
    if (!(progressDistance(curr, prev) > DistanceEpsilon)) {
      throw new Error(
        'FloatMapping - Progress repeats a value: ' + p.join(', ')
      )
    }
    if (curr < prev) {
      wraps++
      if (wraps > 1) {
        throw new Error(
          'FloatMapping - Progress wraps more than once: ' + p.join(', ')
        )
      }
    }
    prev = curr
  }
}

// Distance between two progress values.
// Since progress wraps around, we consider a difference of 0.99 as a distance of 0.01
export function progressDistance(p1: number, p2: number): number {
  const it = Math.abs(p1 - p2)
  return Math.min(it, 1 - it)
}
