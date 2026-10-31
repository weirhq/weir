// Generates the CSS custom properties from Jetpack Compose's Material 3
// tokens (tokens/androidx, pinned by scripts/androidx.ts) and this
// package's theme choices (tokens/m3.json):
//   node scripts/tokens.ts <src dir>
// writes <src dir>/tokens.gen.css, the system tokens, and one
// <src dir>/tokens/<component>.gen.css per component token set. A design
// change is a change to the JSON or the pin, never to the CSS.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {
  argbFromHex,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeExpressive,
  SchemeTonalSpot,
  SchemeVibrant
} from '@material/material-color-utilities'
import { parseTokenFile, type Property, type TokenObject } from './kotlin.ts'
import { springEasing } from './spring.ts'

export type Theme = {
  color: {
    seed: string
    variant: 'tonal-spot' | 'expressive' | 'vibrant'
    specVersion: '2021' | '2025'
    contrast: number
  }
  typeface: { brand: string; plain: string }
  motion: 'expressive' | 'standard'
}

// Files whose tokens aren't emitted, and why.
const unused: Record<string, string> = {
  'ColorDarkTokens.kt': 'the baseline dark scheme; colours come from the seed',
  'ColorLightTokens.kt':
    'the baseline light scheme; colours come from the seed',
  'PaletteTokens.kt': 'the baseline palette; colours come from the seed',
  'TypographyTokens.kt': 'TextStyles built from TypeScaleTokens',
  'TypefaceTokens.kt': 'read for weights; families come from the theme'
}

// Key token sets: names that other tokens refer to.
const keys = new Set([
  'ColorSchemeKeyTokens',
  'MotionSchemeKeyTokens',
  'ShapeKeyTokens',
  'TypographyKeyTokens'
])

const system = new Set([
  'ElevationTokens',
  'ExpressiveMotionTokens',
  'MotionTokens',
  'ShapeTokens',
  'StandardMotionTokens',
  'StateTokens',
  'TypeScaleTokens'
])

const schemes = {
  'tonal-spot': SchemeTonalSpot,
  expressive: SchemeExpressive,
  vibrant: SchemeVibrant
}

// ButtonXSmall -> button-x-small; SurfaceContainerHigh -> surface-container-high.
export const kebab = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replaceAll('_', '-')
    .toLowerCase()

const rem = (n: number) => `${n / 16}rem`
const num = (text: string) => String(Number(text.replace(/f$/, '')))
const weights: Record<string, number> = { Normal: 400, Medium: 500, Bold: 700 }
const typeParts = ['Font', 'LineHeight', 'Size', 'Tracking', 'Weight'] as const

export function colorRoles(
  theme: Theme,
  dark: boolean
): Record<string, string> {
  const { seed, variant, specVersion, contrast } = theme.color
  const scheme: DynamicScheme = new schemes[variant](
    Hct.fromInt(argbFromHex(seed)),
    dark,
    contrast,
    specVersion
  )
  const colors = new MaterialDynamicColors()
  const roles: Record<string, string> = {}
  // Compose's colour scheme also names surface tint and surface variant,
  // which allColors leaves out.
  for (const color of [
    ...colors.allColors,
    colors.shadow(),
    colors.scrim(),
    colors.surfaceTint(),
    colors.surfaceVariant()
  ]) {
    roles[kebab(color.name)] = hexFromArgb(color.getArgb(scheme))
  }
  return roles
}

export type Tokens = { objects: Map<string, TokenObject> }

export function readTokens(
  dir = new URL('../tokens/androidx/', import.meta.url)
): Tokens {
  const objects = new Map<string, TokenObject>()
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.kt'))
    .sort()) {
    if (file in unused && file !== 'TypefaceTokens.kt') continue
    const found = parseTokenFile(file, readFileSync(new URL(file, dir), 'utf8'))
    if (found.length === 0) throw new Error(`${file}: no token object`)
    for (const o of found) objects.set(o.name, o)
  }
  return { objects }
}

export function readTheme(): Theme {
  return JSON.parse(
    readFileSync(new URL('../tokens/m3.json', import.meta.url), 'utf8')
  ) as Theme
}

class Generator {
  private names: Record<string, Set<string>> = {}
  private tokens: Tokens
  private roles: Set<string>

  constructor(tokens: Tokens, roles: Set<string>) {
    this.tokens = tokens
    this.roles = roles
    for (const k of keys)
      this.names[k] = new Set(this.get(k).props.map((p) => p.name))
  }

  get(name: string): TokenObject {
    const o = this.tokens.objects.get(name)
    if (!o) throw new Error(`no ${name} in the androidx tokens`)
    return o
  }

  private key(set: string, name: string, at: string): string {
    if (!this.names[set]!.has(name))
      throw new Error(`${at}: ${set}.${name} doesn't exist`)
    return kebab(name)
  }

  private weight(name: string, at: string): string {
    const p = this.get('TypefaceTokens').props.find((p) => p.name === name)
    const w = /^FontWeight\.(\w+)$/.exec(p?.expr ?? '')?.[1]
    if (!w || !(w in weights)) throw new Error(`${at}: unknown weight ${name}`)
    return String(weights[w])
  }

  // The CSS value for a token expression, or an error naming where it is.
  value(o: TokenObject, p: Property): string {
    const at = `${o.file}:${p.line} (${o.name}.${p.name})`
    const e = p.expr
    let m: RegExpExecArray | null
    if ((m = /^ColorSchemeKeyTokens\.(\w+)$/.exec(e))) {
      const role = this.key('ColorSchemeKeyTokens', m[1]!, at)
      if (!this.roles.has(role))
        throw new Error(`${at}: no colour role ${role}`)
      return `var(--md-sys-color-${role})`
    }
    if ((m = /^ShapeKeyTokens\.(\w+)$/.exec(e)))
      return `var(--md-sys-shape-${this.key('ShapeKeyTokens', m[1]!, at)})`
    if ((m = /^(ShapeTokens|ElevationTokens)\.(\w+)$/.exec(e))) {
      const object = m[1]!
      const name = m[2]!
      const set = object === 'ShapeTokens' ? 'shape' : 'elevation'
      if (!this.get(object).props.some((q) => q.name === name))
        throw new Error(`${at}: ${e} doesn't exist`)
      return `var(--md-sys-${set}-${kebab(name)})`
    }
    if ((m = /^TypefaceTokens\.(Brand|Plain)$/.exec(e)))
      return `var(--md-ref-typeface-${m[1]!.toLowerCase()})`
    if ((m = /^TypefaceTokens\.(Weight\w+)$/.exec(e)))
      return this.weight(m[1]!, at)
    if ((m = /^(-?[\d.]+)\.dp$/.exec(e))) return `${num(m[1]!)}px`
    if ((m = /^(-?[\d.]+)\.sp$/.exec(e))) return rem(Number(m[1]))
    if ((m = /^(-?[\d.]+)f?$/.exec(e))) return num(m[1]!)
    if ((m = /^(?:RoundedCornerShape|CornerSize)\((-?[\d.]+)\.dp\)$/.exec(e)))
      return `${num(m[1]!)}px`
    if ((m = /^RoundedCornerShape\((.*)\)$/.exec(e))) {
      // Corners in CSS order, read left to right.
      const corners = Object.fromEntries(
        m[1]!.split(', ').map((c) => {
          const [k, v] = c.split(' = ')
          return [k, /^(-?[\d.]+)\.dp$/.exec(v ?? '')?.[1]]
        })
      )
      const order = ['topStart', 'topEnd', 'bottomEnd', 'bottomStart']
      if (order.some((k) => corners[k] === undefined))
        throw new Error(`${at}: can't read ${e}`)
      return order.map((k) => `${num(corners[k]!)}px`).join(' ')
    }
    if (e === 'CircleShape') return '9999px'
    if (e === 'RectangleShape') return '0px'
    if ((m = /^CubicBezierEasing\((.*)\)$/.exec(e)))
      return `cubic-bezier(${m[1]!.split(', ').map(num).join(', ')})`
    throw new Error(`${at}: unknown token expression ${e}`)
  }

  // A typography token stands for five properties, as the typescale does.
  private typography(
    o: TokenObject,
    p: Property,
    prefix: string
  ): [string, string][] {
    const at = `${o.file}:${p.line} (${o.name}.${p.name})`
    const scale = kebab(
      this.key('TypographyKeyTokens', /\.(\w+)$/.exec(p.expr)![1]!, at)
    )
    const base = `${prefix}-${kebab(p.name.replace(/Font$/, ''))}`
    return typeParts.map((part) => [
      `${base}-${kebab(part)}`,
      `var(--md-sys-typescale-${scale}-${kebab(part)})`
    ])
  }

  component(o: TokenObject): [string, string][] {
    const prefix = `--md-comp-${componentName(o.name)}`
    return o.props.flatMap((p): [string, string][] =>
      p.expr.startsWith('TypographyKeyTokens.')
        ? this.typography(o, p, prefix)
        : [[`${prefix}-${kebab(p.name)}`, this.value(o, p)]]
    )
  }

  system(theme: Theme): [string, string][] {
    const out: [string, string][] = [
      ['--md-ref-typeface-brand', theme.typeface.brand],
      ['--md-ref-typeface-plain', theme.typeface.plain]
    ]
    const each = (
      set: string,
      emit: (o: TokenObject, p: Property) => [string, string] | undefined
    ) => {
      const o = this.get(set)
      for (const p of o.props) {
        const pair = emit(o, p)
        if (pair) out.push(pair)
      }
    }
    each('TypeScaleTokens', (o, p) => {
      const part = typeParts.find((t) => p.name.endsWith(t))
      if (!part)
        throw new Error(
          `${o.file}:${p.line}: unknown typescale token ${p.name}`
        )
      const style = kebab(p.name.slice(0, -part.length))
      return [`--md-sys-typescale-${style}-${kebab(part)}`, this.value(o, p)]
    })
    each('ShapeTokens', (o, p) => [
      `--md-sys-shape-${kebab(p.name)}`,
      this.value(o, p)
    ])
    each('ElevationTokens', (o, p) => [
      `--md-sys-elevation-${kebab(p.name)}`,
      this.value(o, p)
    ])
    each('StateTokens', (o, p) => [
      `--md-sys-state-${kebab(p.name)}`,
      this.value(o, p)
    ])
    each('MotionTokens', (o, p) => {
      if (p.name.startsWith('Duration'))
        return [`--md-sys-motion-${kebab(p.name)}`, `${this.value(o, p)}ms`]
      const easing = /^Easing(\w+)CubicBezier$/.exec(p.name)
      if (easing)
        return [`--md-sys-motion-easing-${kebab(easing[1]!)}`, this.value(o, p)]
      throw new Error(`${o.file}:${p.line}: unknown motion token ${p.name}`)
    })
    // Springs, from the theme's motion scheme: an easing and its duration.
    const springs = this.get(
      theme.motion === 'expressive'
        ? 'ExpressiveMotionTokens'
        : 'StandardMotionTokens'
    )
    const params: Record<string, { damping?: number; stiffness?: number }> = {}
    for (const p of springs.props) {
      const m = /^Spring(\w+)(Damping|Stiffness)$/.exec(p.name)
      if (!m)
        throw new Error(
          `${springs.file}:${p.line}: unknown spring token ${p.name}`
        )
      const s = (params[kebab(m[1]!)] ??= {})
      s[m[2] === 'Damping' ? 'damping' : 'stiffness'] = Number(
        this.value(springs, p)
      )
    }
    for (const [name, s] of Object.entries(params)) {
      if (s.damping === undefined || s.stiffness === undefined)
        throw new Error(
          `${springs.file}: spring ${name} needs damping and stiffness`
        )
      const { easing, ms } = springEasing({
        damping: s.damping,
        stiffness: s.stiffness
      })
      out.push([`--md-sys-motion-spring-${name}`, easing])
      out.push([`--md-sys-motion-spring-${name}-duration`, `${ms}ms`])
    }
    return out
  }
}

// ButtonSmallTokens -> button-small.
export const componentName = (object: string) =>
  kebab(object.replace(/Tokens$/, ''))

export function componentObjects(tokens: Tokens): TokenObject[] {
  return [...tokens.objects.values()].filter(
    (o) =>
      !keys.has(o.name) && !system.has(o.name) && o.name !== 'TypefaceTokens'
  )
}

function block(selector: string, props: [string, string][]): string {
  return `${selector} {\n${props.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`
}

const colorProps = (roles: Record<string, string>): [string, string][] =>
  Object.entries(roles).map(([name, hex]) => [`--md-sys-color-${name}`, hex])

const header = (from: string) =>
  `/* Generated by scripts/tokens.ts from ${from}. Do not edit. */\n`

export function buildSystemCss(theme: Theme, tokens: Tokens): string {
  const light = colorRoles(theme, false)
  const gen = new Generator(tokens, new Set(Object.keys(light)))
  return [
    header('tokens/m3.json and tokens/androidx'),
    block(':root', [
      ['color-scheme', 'light dark'],
      ...gen.system(theme),
      ...colorProps(light)
    ]),
    `@media (prefers-color-scheme: dark) {\n${block(
      ":root:not([data-theme='light'])",
      colorProps(colorRoles(theme, true))
    )
      .replace(/^/gm, '  ')
      .trimEnd()}\n}\n`,
    block(":root[data-theme='dark']", colorProps(colorRoles(theme, true)))
  ].join('\n')
}

// A component's tokens apply to elements with its class, so they resolve
// against whatever system tokens are in effect there, and :where() keeps
// them easy to override.
export function buildComponentCss(
  theme: Theme,
  tokens: Tokens
): Map<string, string> {
  const gen = new Generator(
    tokens,
    new Set(Object.keys(colorRoles(theme, false)))
  )
  const files = new Map<string, string>()
  for (const o of componentObjects(tokens)) {
    const name = componentName(o.name)
    files.set(
      name,
      header(`tokens/androidx/${o.file}`) +
        '\n' +
        block(`:where(.md-comp-${name})`, gen.component(o))
    )
  }
  return files
}

if (import.meta.main) {
  const src = process.argv[2]
  if (!src) {
    console.error('usage: node scripts/tokens.ts <src dir>')
    process.exit(2)
  }
  const theme = readTheme()
  const tokens = readTokens()
  writeFileSync(`${src}/tokens.gen.css`, buildSystemCss(theme, tokens))
  rmSync(`${src}/tokens`, { recursive: true, force: true })
  mkdirSync(`${src}/tokens`)
  for (const [name, css] of buildComponentCss(theme, tokens))
    writeFileSync(`${src}/tokens/${name}.gen.css`, css)
}
