// Web helpers for drawing cubics; not part of androidx graphics-shapes.

import type { Cubic } from './cubic'

/** An SVG path ("M x y C ... Z") through the given closed outline. */
export function toSvgPath(cubics: readonly Cubic[]): string {
  const first = cubics[0]
  if (first === undefined) return ''
  const parts = [`M ${first.anchor0X} ${first.anchor0Y}`]
  for (const c of cubics) {
    parts.push(
      `C ${c.control0X} ${c.control0Y} ${c.control1X} ${c.control1Y} ${c.anchor1X} ${c.anchor1Y}`
    )
  }
  parts.push('Z')
  return parts.join(' ')
}

/**
 * Appends the given closed outline to [path] (a new Path2D by default). Throws where Path2D
 * doesn't exist, such as jsdom.
 */
export function toPath2D(cubics: readonly Cubic[], path?: Path2D): Path2D {
  if (path === undefined) {
    if (typeof Path2D === 'undefined') {
      throw new Error('Path2D is not available in this environment')
    }
    path = new Path2D()
  }
  const first = cubics[0]
  if (first === undefined) return path
  path.moveTo(first.anchor0X, first.anchor0Y)
  for (const c of cubics) {
    path.bezierCurveTo(
      c.control0X,
      c.control0Y,
      c.control1X,
      c.control1Y,
      c.anchor1X,
      c.anchor1Y
    )
  }
  path.closePath()
  return path
}
