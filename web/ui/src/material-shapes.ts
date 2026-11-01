// Ported from androidx compose material3 MaterialShapes.kt at commit 1608250 (Apache-2.0).
// Only the geometry: the Compose Path/Shape adapters (toPath, toShape) are left out.

import {
  CornerRounding,
  Point,
  RoundedPolygon,
  type PointTransformer
} from './shapes'

// Compose's Matrix().rotateZ(degrees) and Matrix().scale(x, y), applied to points the way
// material3's internal RoundedPolygon.transformed(Matrix) does (Matrix.map).
function rotateZ(degrees: number): PointTransformer {
  const r = degrees * (Math.PI / 180)
  const s = Math.sin(r)
  const c = Math.cos(r)
  return (x, y) => [c * x + -s * y, s * x + c * y]
}

function scale(sx: number, sy: number): PointTransformer {
  return (x, y) => [sx * x, sy * y]
}

// Cache various roundings for use below
const cornerRound15 = new CornerRounding(0.15)
const cornerRound20 = new CornerRounding(0.2)
const cornerRound30 = new CornerRounding(0.3)
const cornerRound50 = new CornerRounding(0.5)
const cornerRound100 = new CornerRounding(1)

const rotateNeg45 = rotateZ(-45)
const rotateNeg90 = rotateZ(-90)
const rotateNeg135 = rotateZ(-135)

const cache = new Map<() => RoundedPolygon, RoundedPolygon>()

function normalizedOnce(build: () => RoundedPolygon): RoundedPolygon {
  let shape = cache.get(build)
  if (shape === undefined) {
    shape = build().normalized()
    cache.set(build, shape)
  }
  return shape
}

/**
 * Predefined Material Design shapes as [RoundedPolygon]s, to use as they are or in a [Morph].
 * Each is built on first use and normalized to fit the (0, 0) -> (1, 1) square.
 */
export const MaterialShapes = {
  /** A circle shape. */
  get Circle(): RoundedPolygon {
    return normalizedOnce(circle)
  },

  /** A rounded square shape. */
  get Square(): RoundedPolygon {
    return normalizedOnce(square)
  },

  /** A slanted square shape. */
  get Slanted(): RoundedPolygon {
    return normalizedOnce(slanted)
  },

  /** An arch shape. */
  get Arch(): RoundedPolygon {
    return normalizedOnce(arch)
  },

  /** A fan shape. */
  get Fan(): RoundedPolygon {
    return normalizedOnce(fan)
  },

  /** An arrow shape. */
  get Arrow(): RoundedPolygon {
    return normalizedOnce(arrow)
  },

  /** A semi-circle shape. */
  get SemiCircle(): RoundedPolygon {
    return normalizedOnce(semiCircle)
  },

  /** An oval shape. */
  get Oval(): RoundedPolygon {
    return normalizedOnce(oval)
  },

  /** A pill shape. */
  get Pill(): RoundedPolygon {
    return normalizedOnce(pill)
  },

  /** A rounded triangle shape. */
  get Triangle(): RoundedPolygon {
    return normalizedOnce(triangle)
  },

  /** A diamond shape. */
  get Diamond(): RoundedPolygon {
    return normalizedOnce(diamond)
  },

  /** A clam-shell shape. */
  get ClamShell(): RoundedPolygon {
    return normalizedOnce(clamShell)
  },

  /** A pentagon shape. */
  get Pentagon(): RoundedPolygon {
    return normalizedOnce(pentagon)
  },

  /** A gem shape. */
  get Gem(): RoundedPolygon {
    return normalizedOnce(gem)
  },

  /** A sunny shape. */
  get Sunny(): RoundedPolygon {
    return normalizedOnce(sunny)
  },

  /** A very-sunny shape. */
  get VerySunny(): RoundedPolygon {
    return normalizedOnce(verySunny)
  },

  /** A 4-sided cookie shape. */
  get Cookie4Sided(): RoundedPolygon {
    return normalizedOnce(cookie4)
  },

  /** A 6-sided cookie shape. */
  get Cookie6Sided(): RoundedPolygon {
    return normalizedOnce(cookie6)
  },

  /** A 7-sided cookie shape. */
  get Cookie7Sided(): RoundedPolygon {
    return normalizedOnce(cookie7)
  },

  /** A 9-sided cookie shape. */
  get Cookie9Sided(): RoundedPolygon {
    return normalizedOnce(cookie9)
  },

  /** A 12-sided cookie shape. */
  get Cookie12Sided(): RoundedPolygon {
    return normalizedOnce(cookie12)
  },

  /** A ghost-ish shape. */
  get Ghostish(): RoundedPolygon {
    return normalizedOnce(ghostish)
  },

  /** A 4-leaf clover shape. */
  get Clover4Leaf(): RoundedPolygon {
    return normalizedOnce(clover4)
  },

  /** An 8-leaf clover shape. */
  get Clover8Leaf(): RoundedPolygon {
    return normalizedOnce(clover8)
  },

  /** A burst shape. */
  get Burst(): RoundedPolygon {
    return normalizedOnce(burst)
  },

  /** A soft-burst shape. */
  get SoftBurst(): RoundedPolygon {
    return normalizedOnce(softBurst)
  },

  /** A boom shape. */
  get Boom(): RoundedPolygon {
    return normalizedOnce(boom)
  },

  /** A soft-boom shape. */
  get SoftBoom(): RoundedPolygon {
    return normalizedOnce(softBoom)
  },

  /** A flower shape. */
  get Flower(): RoundedPolygon {
    return normalizedOnce(flower)
  },

  /** A puffy shape. */
  get Puffy(): RoundedPolygon {
    return normalizedOnce(puffy)
  },

  /** A puffy-diamond shape. */
  get PuffyDiamond(): RoundedPolygon {
    return normalizedOnce(puffyDiamond)
  },

  /** A pixel-circle shape. */
  get PixelCircle(): RoundedPolygon {
    return normalizedOnce(pixelCircle)
  },

  /** A pixel-triangle shape. */
  get PixelTriangle(): RoundedPolygon {
    return normalizedOnce(pixelTriangle)
  },

  /** A bun shape. */
  get Bun(): RoundedPolygon {
    return normalizedOnce(bun)
  },

  /** A heart shape. */
  get Heart(): RoundedPolygon {
    return normalizedOnce(heart)
  }
}

function circle(numVertices = 10): RoundedPolygon {
  return RoundedPolygon.circle(numVertices)
}

function square(): RoundedPolygon {
  return RoundedPolygon.rectangle({
    width: 1,
    height: 1,
    rounding: cornerRound30
  })
}

function slanted(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.926, 0.97, new CornerRounding(0.189, 0.811)),
      pnr(-0.021, 0.967, new CornerRounding(0.187, 0.057))
    ],
    2
  )
}

function arch(): RoundedPolygon {
  return new RoundedPolygon(4, {
    perVertexRounding: [
      cornerRound100,
      cornerRound100,
      cornerRound20,
      cornerRound20
    ]
  }).transformed(rotateNeg135)
}

function fan(): RoundedPolygon {
  return customPolygon(
    [
      pnr(1.004, 1.0, new CornerRounding(0.148, 0.417)),
      pnr(0.0, 1.0, new CornerRounding(0.151)),
      pnr(0.0, -0.003, new CornerRounding(0.148)),
      pnr(0.978, 0.02, new CornerRounding(0.803))
    ],
    1
  )
}

function arrow(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, 0.892, new CornerRounding(0.313)),
      pnr(-0.216, 1.05, new CornerRounding(0.207)),
      pnr(0.499, -0.16, new CornerRounding(0.215, 1.0)),
      pnr(1.225, 1.06, new CornerRounding(0.211))
    ],
    1
  )
}

function semiCircle(): RoundedPolygon {
  return RoundedPolygon.rectangle({
    width: 1.6,
    height: 1,
    perVertexRounding: [
      cornerRound20,
      cornerRound20,
      cornerRound100,
      cornerRound100
    ]
  })
}

function oval(): RoundedPolygon {
  const m = scale(1, 0.64)
  return RoundedPolygon.circle().transformed(m).transformed(rotateNeg45)
}

function pill(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.961, 0.039, new CornerRounding(0.426)),
      pnr(1.001, 0.428),
      pnr(1.0, 0.609, new CornerRounding(1.0))
    ],
    2,
    true
  )
}

function triangle(): RoundedPolygon {
  return new RoundedPolygon(3, { rounding: cornerRound20 }).transformed(
    rotateNeg90
  )
}

function diamond(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, 1.096, new CornerRounding(0.151, 0.524)),
      pnr(0.04, 0.5, new CornerRounding(0.159))
    ],
    2
  )
}

function clamShell(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.171, 0.841, new CornerRounding(0.159)),
      pnr(-0.02, 0.5, new CornerRounding(0.14)),
      pnr(0.17, 0.159, new CornerRounding(0.159))
    ],
    2
  )
}

function pentagon(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, -0.009, new CornerRounding(0.172)),
      pnr(1.03, 0.365, new CornerRounding(0.164)),
      pnr(0.828, 0.97, new CornerRounding(0.169))
    ],
    1,
    true
  )
}

function gem(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.499, 1.023, new CornerRounding(0.241, 0.778)),
      pnr(-0.005, 0.792, new CornerRounding(0.208)),
      pnr(0.073, 0.258, new CornerRounding(0.228)),
      pnr(0.433, -0.0, new CornerRounding(0.491))
    ],
    1,
    true
  )
}

function sunny(): RoundedPolygon {
  return RoundedPolygon.star(8, { innerRadius: 0.8, rounding: cornerRound15 })
}

function verySunny(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, 1.08, new CornerRounding(0.085)),
      pnr(0.358, 0.843, new CornerRounding(0.085))
    ],
    8
  )
}

function cookie4(): RoundedPolygon {
  return customPolygon(
    [
      pnr(1.237, 1.236, new CornerRounding(0.258)),
      pnr(0.5, 0.918, new CornerRounding(0.233))
    ],
    4
  )
}

function cookie6(): RoundedPolygon {
  // 6-point cookie
  return customPolygon(
    [
      pnr(0.723, 0.884, new CornerRounding(0.394)),
      pnr(0.5, 1.099, new CornerRounding(0.398))
    ],
    6
  )
}

function cookie7(): RoundedPolygon {
  // 7-point cookie
  return RoundedPolygon.star(7, {
    innerRadius: 0.75,
    rounding: cornerRound50
  }).transformed(rotateNeg90)
}

function cookie9(): RoundedPolygon {
  return RoundedPolygon.star(9, {
    innerRadius: 0.8,
    rounding: cornerRound50
  }).transformed(rotateNeg90)
}

function cookie12(): RoundedPolygon {
  return RoundedPolygon.star(12, {
    innerRadius: 0.8,
    rounding: cornerRound50
  }).transformed(rotateNeg90)
}

function ghostish(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, 0, new CornerRounding(1.0)),
      pnr(1, 0, new CornerRounding(1.0)),
      pnr(1, 1.14, new CornerRounding(0.254, 0.106)),
      pnr(0.575, 0.906, new CornerRounding(0.253))
    ],
    1,
    true
  )
}

function clover4(): RoundedPolygon {
  return customPolygon(
    [pnr(0.5, 0.074), pnr(0.725, -0.099, new CornerRounding(0.476))],
    4,
    true
  )
}

function clover8(): RoundedPolygon {
  return customPolygon(
    [pnr(0.5, 0.036), pnr(0.758, -0.101, new CornerRounding(0.209))],
    8
  )
}

function burst(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, -0.006, new CornerRounding(0.006)),
      pnr(0.592, 0.158, new CornerRounding(0.006))
    ],
    12
  )
}

function softBurst(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.193, 0.277, new CornerRounding(0.053)),
      pnr(0.176, 0.055, new CornerRounding(0.053))
    ],
    10
  )
}

function boom(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.457, 0.296, new CornerRounding(0.007)),
      pnr(0.5, -0.051, new CornerRounding(0.007))
    ],
    15
  )
}

function softBoom(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.733, 0.454),
      pnr(0.839, 0.437, new CornerRounding(0.532)),
      pnr(0.949, 0.449, new CornerRounding(0.439, 1.0)),
      pnr(0.998, 0.478, new CornerRounding(0.174))
    ],
    16,
    true
  )
}

function flower(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.37, 0.187),
      pnr(0.416, 0.049, new CornerRounding(0.381)),
      pnr(0.479, 0.001, new CornerRounding(0.095))
    ],
    8,
    true
  )
}

function puffy(): RoundedPolygon {
  const m = scale(1, 0.742)
  return customPolygon(
    [
      pnr(0.5, 0.053),
      pnr(0.545, -0.04, new CornerRounding(0.405)),
      pnr(0.67, -0.035, new CornerRounding(0.426)),
      pnr(0.717, 0.066, new CornerRounding(0.574)),
      pnr(0.722, 0.128),
      pnr(0.777, 0.002, new CornerRounding(0.36)),
      pnr(0.914, 0.149, new CornerRounding(0.66)),
      pnr(0.926, 0.289, new CornerRounding(0.66)),
      pnr(0.881, 0.346),
      pnr(0.94, 0.344, new CornerRounding(0.126)),
      pnr(1.003, 0.437, new CornerRounding(0.255))
    ],
    2,
    true
  ).transformed(m)
}

function puffyDiamond(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.87, 0.13, new CornerRounding(0.146)),
      pnr(0.818, 0.357),
      pnr(1.0, 0.332, new CornerRounding(0.853))
    ],
    4,
    true
  )
}

function pixelCircle(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, 0.0),
      pnr(0.704, 0.0),
      pnr(0.704, 0.065),
      pnr(0.843, 0.065),
      pnr(0.843, 0.148),
      pnr(0.926, 0.148),
      pnr(0.926, 0.296),
      pnr(1.0, 0.296)
    ],
    2,
    true
  )
}

function pixelTriangle(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.11, 0.5),
      pnr(0.113, 0.0),
      pnr(0.287, 0.0),
      pnr(0.287, 0.087),
      pnr(0.421, 0.087),
      pnr(0.421, 0.17),
      pnr(0.56, 0.17),
      pnr(0.56, 0.265),
      pnr(0.674, 0.265),
      pnr(0.675, 0.344),
      pnr(0.789, 0.344),
      pnr(0.789, 0.439),
      pnr(0.888, 0.439)
    ],
    1,
    true
  )
}

function bun(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.796, 0.5),
      pnr(0.853, 0.518, new CornerRounding(1)),
      pnr(0.992, 0.631, new CornerRounding(1)),
      pnr(0.968, 1.0, new CornerRounding(1))
    ],
    2,
    true
  )
}

function heart(): RoundedPolygon {
  return customPolygon(
    [
      pnr(0.5, 0.268, new CornerRounding(0.016)),
      pnr(0.792, -0.066, new CornerRounding(0.958)),
      pnr(1.064, 0.276, new CornerRounding(1.0)),
      pnr(0.501, 0.946, new CornerRounding(0.129))
    ],
    1,
    true
  )
}

interface PointNRound {
  o: Point
  r: CornerRounding
}

function pnr(
  x: number,
  y: number,
  r: CornerRounding = CornerRounding.Unrounded
): PointNRound {
  return { o: new Point(x, y), r }
}

function doRepeat(
  points: readonly PointNRound[],
  reps: number,
  center: Point,
  mirroring: boolean
): PointNRound[] {
  const result: PointNRound[] = []
  if (mirroring) {
    const angles = points.map((it) => angleDegrees(it.o.minus(center)))
    const distances = points.map((it) => it.o.minus(center).getDistance())
    const actualReps = reps * 2
    const sectionAngle = 360 / actualReps
    for (let it = 0; it < actualReps; it++) {
      for (let index = 0; index < points.length; index++) {
        const i = it % 2 === 0 ? index : points.length - 1 - index
        if (i > 0 || it % 2 === 0) {
          const a = toRadians(
            sectionAngle * it +
              (it % 2 === 0
                ? angles[i]!
                : sectionAngle - angles[i]! + 2 * angles[0]!)
          )
          const finalPoint = new Point(Math.cos(a), Math.sin(a))
            .times(distances[i]!)
            .plus(center)
          result.push({ o: finalPoint, r: points[i]!.r })
        }
      }
    }
  } else {
    const np = points.length
    for (let it = 0; it < np * reps; it++) {
      const point = rotateDegrees(
        points[it % np]!.o,
        (Math.floor(it / np) * 360) / reps,
        center
      )
      result.push({ o: point, r: points[it % np]!.r })
    }
  }
  return result
}

function rotateDegrees(
  offset: Point,
  angle: number,
  center: Point = new Point(0, 0)
): Point {
  const a = toRadians(angle)
  const off = offset.minus(center)
  return new Point(
    off.x * Math.cos(a) - off.y * Math.sin(a),
    off.x * Math.sin(a) + off.y * Math.cos(a)
  ).plus(center)
}

function toRadians(degrees: number): number {
  return (degrees / 360) * 2 * Math.PI
}

function angleDegrees(offset: Point): number {
  return (Math.atan2(offset.y, offset.x) * 180) / Math.PI
}

function customPolygon(
  pnr: readonly PointNRound[],
  reps: number,
  mirroring = false,
  center: Point = new Point(0.5, 0.5)
): RoundedPolygon {
  const actualPoints = doRepeat(pnr, reps, center, mirroring)
  const vertices = new Array<number>(actualPoints.length * 2)
  for (let ix = 0; ix < vertices.length; ix++) {
    const it = actualPoints[Math.floor(ix / 2)]!.o
    vertices[ix] = ix % 2 === 0 ? it.x : it.y
  }
  return new RoundedPolygon(vertices, {
    perVertexRounding: actualPoints.map((p) => p.r),
    centerX: center.x,
    centerY: center.y
  })
}
