// @vitest-environment node
import { buildCss, colorRoles, readSource } from '../scripts/tokens'

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

describe.each([false, true])('colour roles (dark: %s)', (dark) => {
  const roles = colorRoles(readSource(), dark)

  it.each(pairs)('%s and %s meet WCAG AA for text', (bg, fg) => {
    expect(contrast(roles[bg]!, roles[fg]!)).toBeGreaterThanOrEqual(4.5)
  })
})

it('emits light and dark schemes and every typescale and shape token', () => {
  const css = buildCss(readSource())
  expect(css).toContain('@media (prefers-color-scheme: dark)')
  expect(css).toContain(":root[data-theme='dark']")
  expect(css).toContain('--md-sys-typescale-label-large-weight: 500;')
  expect(css).toContain('--md-sys-shape-corner-extra-extra-large: 48px;')
  expect(css.match(/--md-sys-color-primary:/g)).toHaveLength(3)
})
