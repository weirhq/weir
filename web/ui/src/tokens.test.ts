// @vitest-environment node
import { checkPin, readPin } from '../scripts/androidx'
import { parseTokenFile } from '../scripts/kotlin'
import { settleTime, springEasing } from '../scripts/spring'
import {
  buildComponentCss,
  buildSystemCss,
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
