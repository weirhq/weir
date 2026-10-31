// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { checkPin, readPin } from '../scripts/androidx'
import { checkFontPin, readFontPin } from '../scripts/fonts'
import { parseTokenFile } from '../scripts/kotlin'
import { settleTime, springEasing } from '../scripts/spring'
import {
  buildComponentCss,
  buildSystemCss,
  fontFaces,
  colorRoles,
  componentObjects,
  kebab,
  readTheme,
  readTokens
} from '../scripts/tokens'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const pairs = [
  ['primary', 'on-primary'],
  ['primary-container', 'on-primary-container'],
  ['secondary', 'on-secondary'],
  ['secondary-container', 'on-secondary-container'],
  ['tertiary', 'on-tertiary'],
  ['tertiary-container', 'on-tertiary-container'],
  ['error', 'on-error'],
  ['error-container', 'on-error-container'],
  ['surface', 'on-surface'],
  ['surface-container', 'on-surface-variant']
] as const

const theme = readTheme()
const tokens = readTokens()

describe.each([false, true])('colour roles (dark: %s)', (dark) => {
  const roles = colorRoles(theme, dark)

  it.each(pairs)('%s and %s meet WCAG AA for text', (bg, fg) => {
    expect(contrast(roles[bg]!, roles[fg]!)).toBeGreaterThanOrEqual(4.5)
  })

  it("has every role in Compose's colour scheme", () => {
    const keys = tokens.objects.get('ColorSchemeKeyTokens')!.props
    expect(keys.map((p) => kebab(p.name)).filter((k) => !(k in roles))).toEqual(
      []
    )
  })
})

describe('the androidx pin', () => {
  it('matches the vendored files', () => {
    expect(checkPin()).toEqual([])
  })

  it('is one full commit', () => {
    expect(readPin().commit).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('parseTokenFile', () => {
  const kt = `internal object FooTokens {
    const val Opacity = 0.38f
    val Shape = RoundedCornerShape(4.0.dp)
    inline val Height: androidx.compose.ui.unit.Dp
        get() = 40.0.dp
    val Top =
        RoundedCornerShape(
            topStart = 28.0.dp,
            topEnd = 28.0.dp,
            bottomEnd = 0.0.dp,
            bottomStart = 0.0.dp,
        )
}
@JvmInline internal value class ColorToken(val id: Int)`

  it('reads all three property forms and multi-line expressions', () => {
    const [foo] = parseTokenFile('FooTokens.kt', kt)
    expect(foo!.name).toBe('FooTokens')
    expect(foo!.props.map((p) => [p.name, p.expr])).toEqual([
      ['Opacity', '0.38f'],
      ['Shape', 'RoundedCornerShape(4.0.dp)'],
      ['Height', '40.0.dp'],
      [
        'Top',
        'RoundedCornerShape(topStart = 28.0.dp, topEnd = 28.0.dp, bottomEnd = 0.0.dp, bottomStart = 0.0.dp)'
      ]
    ])
  })
})

describe('springs', () => {
  it.each([
    [0.6, 800],
    [0.8, 380],
    [1, 1600]
  ])('damping %s, stiffness %s settles at 1', (damping, stiffness) => {
    const { easing, ms } = springEasing({ damping, stiffness })
    const points = easing.slice('linear('.length, -1).split(', ').map(Number)
    expect(points[0]).toBe(0)
    expect(points.at(-1)).toBe(1)
    expect(Math.abs(points.at(-2)! - 1)).toBeLessThan(0.002)
    expect(ms).toBe(Math.round(settleTime({ damping, stiffness }) * 1000))
  })

  it('overshoots when underdamped, and not when critically damped', () => {
    const peak = (damping: number) =>
      Math.max(
        ...springEasing({ damping, stiffness: 800 })
          .easing.slice('linear('.length, -1)
          .split(', ')
          .map(Number)
      )
    expect(peak(0.6)).toBeGreaterThan(1.05)
    expect(peak(1)).toBe(1)
  })
})

describe('system tokens', () => {
  const css = buildSystemCss(theme, tokens)

  it('emits light and dark schemes', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain(":root[data-theme='dark']")
    expect(css.match(/--md-sys-color-primary:/g)).toHaveLength(3)
  })

  it.each([
    ['--md-sys-typescale-label-large-weight', '500'],
    ['--md-sys-typescale-label-large-size', '0.875rem'],
    ['--md-sys-typescale-body-large-emphasized-weight', '500'],
    ['--md-sys-typescale-body-large-font', 'var(--md-ref-typeface-plain)'],
    ['--md-sys-shape-corner-extra-extra-large', '48px'],
    ['--md-sys-shape-corner-full', '9999px'],
    ['--md-sys-shape-corner-extra-large-top', '28px 28px 0px 0px'],
    ['--md-sys-elevation-level3', '6px'],
    ['--md-sys-state-pressed-state-layer-opacity', '0.1'],
    ['--md-sys-motion-duration-medium2', '300ms'],
    [
      '--md-sys-motion-easing-emphasized-decelerate',
      'cubic-bezier(0.05, 0.7, 0.1, 1)'
    ],
    ['--md-sys-motion-spring-fast-spatial-duration', '420ms']
  ])('%s is %s', (name, value) => {
    expect(css).toContain(`${name}: ${value};`)
  })
})

describe('component tokens', () => {
  const files = buildComponentCss(theme, tokens)

  it('makes one kebab-case file per component token set', () => {
    expect(files.size).toBe(componentObjects(tokens).length)
    for (const name of files.keys())
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        'button-x-small',
        'split-button-x-large',
        'fab-menu-baseline'
      ])
    )
  })

  it('scopes tokens to the component class and refers to system tokens', () => {
    const css = files.get('button-small')!
    expect(css).toContain(':where(.md-comp-button-small) {')
    expect(css).toContain('--md-comp-button-small-container-height: 40px;')
    expect(css).toContain(
      '--md-comp-button-small-container-shape-round: var(--md-sys-shape-corner-full);'
    )
  })

  it('expands typography into the five typescale parts', () => {
    const css = files.get('dialog')!
    for (const part of ['font', 'line-height', 'size', 'tracking', 'weight'])
      expect(css).toContain(
        `--md-comp-dialog-headline-${part}: var(--md-sys-typescale-headline-small-${part});`
      )
  })

  it('points every var() at a token that exists', () => {
    const system = buildSystemCss(theme, tokens)
    const defined = new Set(
      [system, ...files.values()].flatMap((css) =>
        [...css.matchAll(/(--md-[\w-]+):/g)].map((m) => m[1]!)
      )
    )
    const missing = [system, ...files.values()]
      .flatMap((css) =>
        [...css.matchAll(/var\((--md-[\w-]+)\)/g)].map((m) => m[1]!)
      )
      .filter((name) => !defined.has(name))
    expect([...new Set(missing)]).toEqual([])
  })
})

describe('fonts', () => {
  const pin = readFontPin()

  it('match their pin', () => {
    expect(checkFontPin()).toEqual([])
  })

  it('cover Latin and Vietnamese in Google Sans Flex, Cyrillic and Greek in Roboto Flex, and the icons', () => {
    expect(pin.faces.map((f) => `${f.family}: ${f.subset}`)).toEqual([
      'Google Sans Flex: latin',
      'Google Sans Flex: latin-ext',
      'Google Sans Flex: vietnamese',
      'Roboto Flex: cyrillic',
      'Roboto Flex: cyrillic-ext',
      'Roboto Flex: greek',
      'Material Symbols Rounded: icons'
    ])
  })

  it('show text in a fallback while loading, but hold icons back', () => {
    const faces = fontFaces(pin).split('@font-face').slice(1)
    expect(faces.at(-1)).toContain("font-family: 'Material Symbols Rounded'")
    expect(faces.at(-1)).toContain('font-display: block;')
    for (const face of faces.slice(0, -1))
      expect(face).toContain('font-display: swap;')
  })

  it('get one @font-face each, loaded from the package', () => {
    const css = fontFaces(pin)
    expect(css.match(/@font-face/g)).toHaveLength(pin.faces.length)
    for (const f of pin.faces)
      expect(css).toContain(`src: url('./fonts/${f.file}') format('woff2');`)
    expect(css).not.toContain('googleapis')
    expect(css).not.toContain('gstatic')
  })

  it('are what the theme asks for first', () => {
    expect(theme.typeface.plain).toMatch(/^'Google Sans Flex', 'Roboto Flex', /)
  })
})

describe('elevation', () => {
  it('draws each level as a shadow', () => {
    const css = buildSystemCss(theme, tokens)
    expect(css).toContain('--md-sys-elevation-shadow-level0: none;')
    expect(css).toMatch(
      /--md-sys-elevation-shadow-level5: 0 4px 4px 0px color-mix\(in srgb, var\(--md-sys-color-shadow\) 30%, transparent\), 0 8px 12px 6px/
    )
  })

  it('gives every component elevation a shadow beside it', () => {
    const css = buildComponentCss(theme, tokens).get('elevated-button')!
    expect(css).toContain(
      '--md-comp-elevated-button-hovered-container-shadow: var(--md-sys-elevation-shadow-level2);'
    )
  })
})

describe('component stylesheets', () => {
  const src = new URL('./', import.meta.url)
  const sheets = readdirSync(src)
    .filter((f) => f.endsWith('.module.css'))
    .map((f) => [f, readFileSync(new URL(f, src), 'utf8')] as const)
  const defined = new Set(
    [
      buildSystemCss(theme, tokens),
      ...buildComponentCss(theme, tokens).values()
    ].flatMap((css) => [...css.matchAll(/(--md-[\w-]+):/g)].map((m) => m[1]!))
  )

  it.each(sheets)('%s uses only tokens that exist', (_, css) => {
    const used = [
      ...css.matchAll(/var\(\s*(--md-(?:sys|comp|ref)-[\w-]+)/g)
    ].map((m) => m[1]!)
    expect(used.filter((name) => !defined.has(name))).toEqual([])
  })
})

// button.module.css relies on these, so a re-pin that breaks them fails here.
describe('button token assumptions', () => {
  const props = (name: string) =>
    Object.fromEntries(
      tokens.objects.get(name)!.props.map((p) => [p.name, p.expr])
    )

  it.each([
    'ButtonXSmallTokens',
    'ButtonSmallTokens',
    'ButtonMediumTokens',
    'ButtonLargeTokens',
    'ButtonXLargeTokens'
  ])('%s rounds fully, so round can be half the height', (name) => {
    const p = props(name)
    expect(p.ContainerShapeRound).toBe('ShapeKeyTokens.CornerFull')
    expect(p.SelectedContainerShapeRound).toBe('ShapeKeyTokens.CornerFull')
  })

  it.each([
    'FilledButtonTokens',
    'FilledTonalButtonTokens',
    'TonalButtonTokens',
    'ElevatedButtonTokens',
    'OutlinedButtonTokens',
    'TextButtonTokens'
  ])('%s keeps its label colours across hover, focus and press', (name) => {
    const p = props(name)
    const differing = Object.keys(p)
      .map((k) => [
        k,
        k.replace(
          /^(Selected|Unselected)?(Hovered|Hover|Focused|Focus|Pressed)/,
          '$1'
        )
      ])
      // Icons take the label colour, as in Compose.
      .filter(([k, rest]) => k !== rest && /Label\w*Color$/.test(k!))
      .filter(([k, rest]) => rest! in p && p[k!] !== p[rest!])
    expect(differing).toEqual([])
  })
})

// icon-button.module.css and fab.module.css rely on these.
describe('icon button and FAB token assumptions', () => {
  const props = (name: string) =>
    Object.fromEntries(
      tokens.objects.get(name)!.props.map((p) => [p.name, p.expr])
    )

  it.each([
    'XSmallIconButtonTokens',
    'SmallIconButtonTokens',
    'MediumIconButtonTokens',
    'LargeIconButtonTokens',
    'XLargeIconButtonTokens'
  ])('%s rounds fully at rest and when a square toggle is selected', (name) => {
    const p = props(name)
    expect(p.ContainerShapeRound).toBe('ShapeKeyTokens.CornerFull')
    expect(p.SelectedContainerShapeSquare).toBe('ShapeKeyTokens.CornerFull')
  })

  it.each([
    'StandardIconButtonTokens',
    'FilledIconButtonTokens',
    'FilledTonalIconButtonTokens',
    'OutlinedIconButtonTokens',
    'FabPrimaryContainerTokens',
    'FabSecondaryContainerTokens'
  ])('%s keeps its content colours across hover, focus and press', (name) => {
    const p = props(name)
    const differing = Object.keys(p)
      .map((k) => [
        k,
        k.replace(/^(Selected|Unselected)?(Hovered|Focused|Pressed)/, '$1')
      ])
      .filter(([k, rest]) => k !== rest && /Color$/.test(k!))
      .filter(([k]) => !/Container|Outline/.test(k!))
      .filter(([k, rest]) => rest! in p && p[k!] !== p[rest!])
    expect(differing).toEqual([])
  })
})
