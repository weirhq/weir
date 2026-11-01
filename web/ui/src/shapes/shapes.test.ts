import { MaterialShapes } from '../material-shapes'
import {
  CornerRounding,
  Cubic,
  Feature,
  Morph,
  RoundedPolygon,
  toPath2D,
  toSvgPath
} from '.'
import { DoubleMapper } from './float-mapping'

const shapeNames = [
  'Circle',
  'Square',
  'Slanted',
  'Arch',
  'Fan',
  'Arrow',
  'SemiCircle',
  'Oval',
  'Pill',
  'Triangle',
  'Diamond',
  'ClamShell',
  'Pentagon',
  'Gem',
  'Sunny',
  'VerySunny',
  'Cookie4Sided',
  'Cookie6Sided',
  'Cookie7Sided',
  'Cookie9Sided',
  'Cookie12Sided',
  'Ghostish',
  'Clover4Leaf',
  'Clover8Leaf',
  'Burst',
  'SoftBurst',
  'Boom',
  'SoftBoom',
  'Flower',
  'Puffy',
  'PuffyDiamond',
  'PixelCircle',
  'PixelTriangle',
  'Bun',
  'Heart'
] as const

type Pt = [number, number]

function sample(cubics: readonly Cubic[], perCubic = 16): Pt[] {
  const points: Pt[] = []
  for (const c of cubics) {
    for (let i = 0; i <= perCubic; i++) {
      const p = c.pointOnCurve(i / perCubic)
      points.push([p.x, p.y])
    }
  }
  return points
}

function distanceToSegment(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length))
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))
}

/** The largest distance from a point in `from` to the polyline through `to`. */
function farthest(from: Pt[], to: Pt[]): number {
  let worst = 0
  for (const [x, y] of from) {
    let best = Infinity
    for (let i = 0; i + 1 < to.length; i++) {
      best = Math.min(best, distanceToSegment(x, y, to[i]!, to[i + 1]!))
    }
    worst = Math.max(worst, best)
  }
  return worst
}

function expectContinuous(cubics: readonly Cubic[], epsilon = 1e-4) {
  for (let i = 0; i < cubics.length; i++) {
    const c = cubics[i]!
    const next = cubics[(i + 1) % cubics.length]!
    expect(Math.abs(c.anchor1X - next.anchor0X)).toBeLessThan(epsilon)
    expect(Math.abs(c.anchor1Y - next.anchor0Y)).toBeLessThan(epsilon)
  }
}

describe('Cubic', () => {
  it('approximates a quarter circle with the standard 0.5523 handle', () => {
    const arc = Cubic.circularArc(0, 0, 1, 0, 0, 1)
    const k = (4 / 3) * (Math.SQRT2 - 1)
    expect(arc.control0X).toBeCloseTo(1, 6)
    expect(arc.control0Y).toBeCloseTo(k, 6)
    expect(arc.control1X).toBeCloseTo(k, 6)
    expect(arc.control1Y).toBeCloseTo(1, 6)
    for (let i = 0; i <= 10; i++) {
      const p = arc.pointOnCurve(i / 10)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 3)
    }
  })

  it('places straight-line controls at thirds', () => {
    const line = Cubic.straightLine(0, 0, 3, 6)
    expect([line.control0X, line.control0Y]).toEqual([1, 2])
    expect([line.control1X, line.control1Y]).toEqual([2, 4])
  })

  it('splits into two halves that meet on the curve', () => {
    const c = new Cubic(0, 0, 1, 2, 3, 2, 4, 0)
    const [a, b] = c.split(0.3)
    const mid = c.pointOnCurve(0.3)
    expect(a.anchor1X).toBeCloseTo(mid.x, 12)
    expect(a.anchor1Y).toBeCloseTo(mid.y, 12)
    expect(b.anchor0X).toBe(a.anchor1X)
    expect(a.pointOnCurve(0.5).x).toBeCloseTo(c.pointOnCurve(0.15).x, 12)
    expect(b.pointOnCurve(0.5).y).toBeCloseTo(c.pointOnCurve(0.65).y, 12)
    expect(c.reverse().reverse().equals(c)).toBe(true)
  })

  it('computes true bounds from the curve extrema', () => {
    const c = new Cubic(0, 0, 0, 1, 1, 1, 1, 0)
    const bounds = [0, 0, 0, 0]
    c.calculateBounds(bounds)
    expect(bounds[1]).toBeCloseTo(0, 12)
    expect(bounds[3]).toBeCloseTo(0.75, 12)
    c.calculateBounds(bounds, true)
    expect(bounds[3]).toBe(1)
  })

  it('transforms every point', () => {
    const c = new Cubic(0, 0, 1, 2, 3, 4, 5, 6).transformed((x, y) => [
      x + 10,
      y * 2
    ])
    expect(Array.from(c.points)).toEqual([10, 0, 11, 4, 13, 8, 15, 12])
  })
})

describe('DoubleMapper', () => {
  it('interpolates between mappings as in the Kotlin docs', () => {
    const mapper = new DoubleMapper([0.2, 0.5], [0.4, 0.6])
    expect(mapper.map(0.3)).toBeCloseTo(0.55, 6)
    expect(mapper.map(0.21)).toBeCloseTo(0.505, 6)
    const half = new DoubleMapper([0, 0], [0.5, 0.25])
    expect(half.map(0.25)).toBeCloseTo(0.125, 6)
    expect(half.map(0.75)).toBeCloseTo(0.625, 6)
    expect(half.mapBack(0.625)).toBeCloseTo(0.75, 6)
  })

  it('rejects progress that wraps twice', () => {
    expect(() => new DoubleMapper([0.5, 0], [0, 0.1], [0.7, 0.2])).toThrow()
  })
})

describe('RoundedPolygon', () => {
  it('builds a circle on the unit radius', () => {
    const circle = RoundedPolygon.circle(8)
    for (const [x, y] of sample(circle.cubics)) {
      expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(1e-3)
    }
    const bounds = circle.calculateBounds(undefined, false)
    expect(bounds[0]).toBeCloseTo(-1, 3)
    expect(bounds[1]).toBeCloseTo(-1, 3)
    expect(bounds[2]).toBeCloseTo(1, 3)
    expect(bounds[3]).toBeCloseTo(1, 3)
    expect(circle.centerX).toBe(0)
    expect(circle.centerY).toBe(0)
    expectContinuous(circle.cubics)
  })

  it('builds an unrounded square from straight lines between the vertices', () => {
    const square = new RoundedPolygon(4)
    expect(square.cubics).toHaveLength(4)
    expect(square.features).toHaveLength(8)
    square.cubics.forEach((c, i) => {
      const angle = (Math.PI / 2) * i
      expect(c.anchor0X).toBeCloseTo(Math.cos(angle), 6)
      expect(c.anchor0Y).toBeCloseTo(Math.sin(angle), 6)
      expect(c.control0X).toBeCloseTo(
        c.anchor0X + (c.anchor1X - c.anchor0X) / 3
      )
      expect(c.control1Y).toBeCloseTo(
        c.anchor0Y + ((c.anchor1Y - c.anchor0Y) * 2) / 3
      )
    })
    expectContinuous(square.cubics)
  })

  it('keeps rounded corners inside the unrounded polygon', () => {
    const rounded = new RoundedPolygon(4, {
      rounding: new CornerRounding(0.3, 0.5)
    })
    // Corner: 3 cubics (first one split in two), edge: 1 cubic.
    expect(rounded.cubics).toHaveLength(17)
    let max = 0
    for (const [x, y] of sample(rounded.cubics)) {
      expect(Math.abs(x) + Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9)
      max = Math.max(max, Math.hypot(x, y))
    }
    // The corners are cut off, so no point reaches a vertex.
    expect(max).toBeLessThan(0.95)
    expectContinuous(rounded.cubics)
  })

  it('alternates outer and inner vertices for a star', () => {
    const star = RoundedPolygon.star(5, { innerRadius: 0.5 })
    expect(star.cubics).toHaveLength(10)
    star.cubics.forEach((c, i) => {
      const r = Math.hypot(c.anchor0X, c.anchor0Y)
      expect(r).toBeCloseTo(i % 2 === 0 ? 1 : 0.5, 6)
    })
    const corners = star.features.filter((f) => !f.isEdge)
    expect(corners.map((f) => f.isConvexCorner)).toEqual(
      Array.from({ length: 10 }, (_, i) => i % 2 === 0)
    )
  })

  it('validates its input like the Kotlin requires', () => {
    expect(() => new RoundedPolygon(2)).toThrow(/at least 3 vertices/)
    expect(() => new RoundedPolygon([0, 0, 1, 0, 1])).toThrow()
    expect(
      () =>
        new RoundedPolygon(4, { perVertexRounding: [CornerRounding.Unrounded] })
    ).toThrow(/perVertexRounding/)
    expect(() => RoundedPolygon.star(4, { innerRadius: 1 })).toThrow()
    expect(() => RoundedPolygon.pill({ width: 0 })).toThrow()
    expect(() => RoundedPolygon.circle(2)).toThrow()
    expect(() => Feature.buildConvexCorner([])).toThrow()
  })

  it('round-trips through its features', () => {
    const shape = RoundedPolygon.rectangle({
      width: 3,
      height: 1,
      rounding: new CornerRounding(0.25)
    })
    const copy = new RoundedPolygon(shape.features)
    expect(copy.cubics.length).toBe(shape.cubics.length)
    expect(new RoundedPolygon(shape).equals(shape)).toBe(true)
  })

  it('normalizes into the unit square, touching both ends of the long axis', () => {
    const shapes = [
      RoundedPolygon.pill(),
      RoundedPolygon.pillStar({ rounding: new CornerRounding(0.1) }),
      RoundedPolygon.rectangle({ width: 1, height: 4 }),
      RoundedPolygon.star(7, { radius: 3, centerX: 5, centerY: -2 })
    ]
    for (const shape of shapes) {
      const bounds = shape.normalized().calculateBounds()
      const [left, top, right, bottom] = bounds as [
        number,
        number,
        number,
        number
      ]
      for (const v of bounds) {
        expect(v).toBeGreaterThanOrEqual(-1e-9)
        expect(v).toBeLessThanOrEqual(1 + 1e-9)
      }
      const wide = right - left >= bottom - top
      const [lo, hi, otherLo, otherHi] = wide
        ? [left, right, top, bottom]
        : [top, bottom, left, right]
      expect(lo).toBeCloseTo(0, 9)
      expect(hi).toBeCloseTo(1, 9)
      expect((otherLo + otherHi) / 2).toBeCloseTo(0.5, 9)
    }
  })

  it('places pill and pillStar outlines within their size', () => {
    const pill = RoundedPolygon.pill({ width: 4, height: 2 })
    const bounds = pill.calculateBounds(undefined, false)
    expect(bounds[0]).toBeCloseTo(-2, 3)
    expect(bounds[2]).toBeCloseTo(2, 3)
    expect(bounds[1]).toBeCloseTo(-1, 3)
    expect(bounds[3]).toBeCloseTo(1, 3)
    const pillStar = RoundedPolygon.pillStar({ numVerticesPerRadius: 10 })
    expect(pillStar.features.filter((f) => !f.isEdge)).toHaveLength(20)
  })

  it('computes max bounds as a square around the center', () => {
    const bounds = RoundedPolygon.rectangle({
      width: 2,
      height: 2
    }).calculateMaxBounds()
    expect(bounds[0]).toBeCloseTo(-Math.SQRT2, 6)
    expect(bounds[2]).toBeCloseTo(Math.SQRT2, 6)
  })
})

describe('Morph', () => {
  const pairs: [string, RoundedPolygon, RoundedPolygon][] = [
    [
      'star to rounded square',
      RoundedPolygon.star(5, {
        innerRadius: 0.5,
        rounding: new CornerRounding(0.1)
      }),
      RoundedPolygon.rectangle({ rounding: new CornerRounding(0.4) })
    ],
    ['circle to cookie', MaterialShapes.Circle, MaterialShapes.Cookie9Sided],
    ['heart to square', MaterialShapes.Heart, MaterialShapes.Square],
    [
      'pixel triangle to flower',
      MaterialShapes.PixelTriangle,
      MaterialShapes.Flower
    ]
  ]

  for (const [name, a, b] of pairs) {
    it(`reproduces both ends of ${name}`, () => {
      const morph = new Morph(a, b)
      const count = morph.morphMatch.length
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const cubics = morph.asCubics(progress)
        expect(cubics).toHaveLength(count)
        expectContinuous(cubics, 1e-3)
        const last = cubics[count - 1]!
        expect(last.anchor1X).toBe(cubics[0]!.anchor0X)
        expect(last.anchor1Y).toBe(cubics[0]!.anchor0Y)
      }
      for (const [progress, shape] of [
        [0, a],
        [1, b]
      ] as const) {
        const morphed = sample(morph.asCubics(progress), 8)
        const original = sample(shape.cubics, 64)
        expect(farthest(morphed, original)).toBeLessThan(2e-3)
        expect(
          farthest(
            sample(shape.cubics, 8),
            sample(morph.asCubics(progress), 64)
          )
        ).toBeLessThan(2e-3)
      }
    })
  }

  it('matches forEachCubic with asCubics', () => {
    const morph = new Morph(MaterialShapes.Sunny, MaterialShapes.Gem)
    const listed = morph.asCubics(0.4)
    const seen: number[][] = []
    morph.forEachCubic(0.4, (c) => seen.push(Array.from(c.points)))
    expect(seen).toHaveLength(listed.length)
    seen.slice(0, -1).forEach((points, i) => {
      expect(points).toEqual(Array.from(listed[i]!.points))
    })
  })

  it('matches nearby features, so a circle-to-cookie midpoint stays round', () => {
    // A bad feature mapping twists or folds the outline towards the center.
    const morph = new Morph(MaterialShapes.Circle, MaterialShapes.Cookie9Sided)
    for (const [x, y] of sample(morph.asCubics(0.5), 8)) {
      const r = Math.hypot(x - 0.5, y - 0.5)
      expect(r).toBeGreaterThan(0.45)
      expect(r).toBeLessThan(0.5)
    }
  })

  it('morphs a shape into itself without change', () => {
    const shape = MaterialShapes.Clover4Leaf
    const morph = new Morph(shape, shape)
    expect(
      farthest(sample(morph.asCubics(0.5), 8), sample(shape.cubics, 64))
    ).toBeLessThan(2e-3)
  })

  it('combines the bounds of both shapes', () => {
    const morph = new Morph(
      RoundedPolygon.rectangle({ width: 4, height: 1 }),
      RoundedPolygon.rectangle({ width: 1, height: 6 })
    )
    expect(morph.calculateBounds()).toEqual([-2, -3, 2, 3])
  })
})

describe('MaterialShapes', () => {
  it.each(shapeNames)('%s is a closed outline in the unit square', (name) => {
    const shape = MaterialShapes[name]
    expect(MaterialShapes[name]).toBe(shape)
    const cubics = shape.cubics
    expect(cubics.length).toBeGreaterThan(2)
    const first = cubics[0]!
    const last = cubics[cubics.length - 1]!
    expect(last.anchor1X).toBe(first.anchor0X)
    expect(last.anchor1Y).toBe(first.anchor0Y)
    expectContinuous(cubics)
    const bounds = shape.calculateBounds()
    for (const v of bounds) {
      expect(v).toBeGreaterThanOrEqual(-1e-9)
      expect(v).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(
      Math.max(bounds[2]! - bounds[0]!, bounds[3]! - bounds[1]!)
    ).toBeCloseTo(1, 9)
  })

  it('keeps the shapes Compose describes', () => {
    // Corners per shape follow from the vertex lists in MaterialShapes.kt.
    const corners = (shape: RoundedPolygon) =>
      shape.features.filter((f) => !f.isEdge).length
    expect(corners(MaterialShapes.Circle)).toBe(10)
    expect(corners(MaterialShapes.Triangle)).toBe(3)
    expect(corners(MaterialShapes.Sunny)).toBe(16)
    expect(corners(MaterialShapes.Burst)).toBe(24)
    expect(corners(MaterialShapes.Heart)).toBe(7)
    expect(corners(MaterialShapes.PixelCircle)).toBe(30)
    // Triangle is rotated -90 degrees, so it points up (negative y on screen).
    const points = sample(MaterialShapes.Triangle.cubics)
    const top = points.reduce((a, b) => (b[1] < a[1] ? b : a))
    expect(top[0]).toBeCloseTo(0.5, 2)
  })
})

describe('paths', () => {
  it('writes an SVG path', () => {
    const path = toSvgPath(new RoundedPolygon(3).cubics)
    expect(path).toMatch(/^M \S+ \S+( C( \S+){6}){3} Z$/)
    expect(toSvgPath([new Cubic(0, 0, 1, 0, 2, 0, 3, 0)])).toBe(
      'M 0 0 C 1 0 2 0 3 0 Z'
    )
  })

  it('draws into a Path2D only when asked', () => {
    const calls: string[] = []
    const path = {
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      bezierCurveTo: (...v: number[]) => calls.push(`C${v.join(',')}`),
      closePath: () => calls.push('Z')
    } as unknown as Path2D
    toPath2D([new Cubic(0, 0, 1, 0, 2, 0, 3, 0)], path)
    expect(calls).toEqual(['M0,0', 'C1,0,2,0,3,0', 'Z'])
    if (typeof Path2D === 'undefined') {
      expect(() => toPath2D([])).toThrow(/Path2D/)
    }
  })
})
