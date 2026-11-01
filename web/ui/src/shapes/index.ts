// A TypeScript port of androidx graphics-shapes at commit 1608250 (Apache-2.0).

export { CornerRounding } from './corner-rounding'
export {
  Cubic,
  MutableCubic,
  type PointTransformer,
  type TransformResult
} from './cubic'
export { Feature } from './features'
export { Morph } from './morph'
export { Point } from './point'
export {
  RoundedPolygon,
  type FeaturesOptions,
  type NumVerticesOptions,
  type Vertices,
  type VerticesOptions
} from './rounded-polygon'
export type {
  CircleOptions,
  PillOptions,
  PillStarOptions,
  RectangleOptions,
  StarOptions
} from './shapes'
export { toPath2D, toSvgPath } from './path'
