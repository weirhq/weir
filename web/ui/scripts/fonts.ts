// Vendors the typefaces into src/fonts/, so they never load from Google:
//   node scripts/fonts.ts pin
// Google Sans Flex, the face M3 Expressive is shown in, covers Latin and
// Vietnamese; Roboto Flex supplies Cyrillic and Greek, which it lacks. Both
// are OFL-1.1. The files are Google Fonts' own woff2 subsets, keeping the
// width and weight axes and Google Sans Flex's roundness (ROND); optical
// size and slant would more than treble the download. Material Symbols
// Rounded (Apache-2.0) is cut down to the icons in src/icon-names.ts, with
// all its axes. PIN.json records each file's @font-face descriptors and
// sha256, and a test checks the files still match it.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { iconNames } from '../src/icon-names.ts'

const dir = new URL('../src/fonts/', import.meta.url)

const googleFonts = 'https://raw.githubusercontent.com/google/fonts/main'

type Family = {
  family: string
  slug: string
  axes: string
  // Subsets to keep, or the icons to cut the font down to.
  subsets?: string[]
  icons?: readonly string[]
  // Licence files to keep beside the fonts, by URL.
  licences: Record<string, string>
}

const families: Family[] = [
  {
    family: 'Google Sans Flex',
    slug: 'google-sans-flex',
    axes: 'wdth,wght,ROND@25..151,1..1000,0..100',
    subsets: ['latin', 'latin-ext', 'vietnamese'],
    licences: {
      'OFL.txt': `${googleFonts}/ofl/googlesansflex/OFL.txt`,
      'TRADEMARKS.md': `${googleFonts}/ofl/googlesansflex/TRADEMARKS.md`
    }
  },
  {
    family: 'Roboto Flex',
    slug: 'roboto-flex',
    axes: 'wdth,wght@25..151,100..1000',
    subsets: ['cyrillic', 'cyrillic-ext', 'greek'],
    licences: { 'OFL.txt': `${googleFonts}/ofl/robotoflex/OFL.txt` }
  },
  {
    family: 'Material Symbols Rounded',
    slug: 'material-symbols-rounded',
    axes: 'opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
    icons: iconNames,
    licences: {
      'LICENSE.txt':
        'https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE'
    }
  }
]

export type Face = {
  family: string
  file: string
  subset: string
  url: string
  style: string
  weight: string
  stretch?: string
  unicodeRange?: string
  sha256: string
}

export type FontPin = { fetched: string; faces: Face[] }

const sha256 = (data: Uint8Array | string) =>
  createHash('sha256').update(data).digest('hex')

export function readFontPin(): FontPin {
  return JSON.parse(readFileSync(new URL('PIN.json', dir), 'utf8')) as FontPin
}

// Names of font files that are missing, changed or not in the pin.
export function checkFontPin(pin: FontPin = readFontPin()): string[] {
  const want = new Map(pin.faces.map((f) => [f.file, f.sha256]))
  const bad = readdirSync(dir).filter(
    (f) => f.endsWith('.woff2') && !want.has(f)
  )
  for (const [file, hash] of want) {
    try {
      if (sha256(readFileSync(new URL(file, dir))) !== hash) bad.push(file)
    } catch {
      bad.push(file)
    }
  }
  return bad.sort()
}

// The Fonts API picks woff2 and @font-face ranges by browser.
const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  return res
}

function optional(block: string, name: string): string | undefined {
  return new RegExp(`${name}: ([^;]+);`).exec(block)?.[1]?.trim()
}

function descriptor(block: string, name: string): string {
  const value = optional(block, name)
  if (!value) throw new Error(`@font-face without ${name}:\n${block}`)
  return value
}

async function pin(): Promise<void> {
  for (const f of readdirSync(dir).filter((f) => /\.(woff2|txt|md)$/.test(f)))
    rmSync(new URL(f, dir))
  const faces: Face[] = []
  for (const fam of families) {
    let query = `family=${fam.family.replaceAll(' ', '+')}:${fam.axes}`
    // The API wants icon names sorted.
    if (fam.icons) query += `&icon_names=${[...fam.icons].sort().join(',')}`
    const css = await (
      await get(`https://fonts.googleapis.com/css2?${query}`)
    ).text()
    // Each face follows a /* subset */ comment; an icon font has one face.
    const blocks = new Map(
      fam.icons
        ? [['icons', /@font-face \{([^}]+)\}/.exec(css)?.[1] ?? '']]
        : [...css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face \{([^}]+)\}/g)].map(
            (m) => [m[1]!, m[2]!]
          )
    )
    for (const subset of fam.subsets ?? ['icons']) {
      const block = blocks.get(subset)
      if (!block) throw new Error(`${fam.family} has no ${subset} subset`)
      const url = /url\((https:[^)]+)\) format\('woff2'\)/.exec(block)?.[1]
      if (!url) throw new Error(`${fam.family} ${subset}: no woff2 URL`)
      const data = new Uint8Array(await (await get(url)).arrayBuffer())
      const file = fam.icons
        ? `${fam.slug}.woff2`
        : `${fam.slug}-${subset}.woff2`
      writeFileSync(new URL(file, dir), data)
      faces.push({
        family: fam.family,
        file,
        subset,
        url,
        style: descriptor(block, 'font-style'),
        weight: descriptor(block, 'font-weight'),
        stretch: optional(block, 'font-stretch'),
        unicodeRange: optional(block, 'unicode-range'),
        sha256: sha256(data)
      })
      console.log(`${file}: ${data.length} bytes`)
    }
    for (const [name, url] of Object.entries(fam.licences)) {
      const text = await (await get(url)).text()
      writeFileSync(new URL(`${fam.slug}-${name}`, dir), text)
    }
  }
  const out: FontPin = { fetched: new Date().toISOString().slice(0, 10), faces }
  writeFileSync(new URL('PIN.json', dir), JSON.stringify(out, null, 2) + '\n')
}

if (import.meta.main) {
  if (process.argv[2] !== 'pin') {
    console.error('usage: node scripts/fonts.ts pin')
    process.exit(2)
  }
  await pin()
}
