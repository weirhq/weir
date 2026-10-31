// Vendors Jetpack Compose's Material 3 token sources (Apache-2.0) from
// androidx at one commit into tokens/androidx/:
//   node scripts/androidx.ts pin <commit>
// PIN.json records the commit and each file's sha256; a test checks the
// files still match it, so the tokens change only by re-pinning.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const repo = 'androidx/androidx'
const path =
  'compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens'
const dir = new URL('../tokens/androidx/', import.meta.url)

export type Pin = {
  repo: string
  path: string
  commit: string
  files: Record<string, string>
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

export function readPin(): Pin {
  return JSON.parse(readFileSync(new URL('PIN.json', dir), 'utf8')) as Pin
}

// Names of vendored files that are missing, changed or not in the pin.
export function checkPin(pin: Pin = readPin()): string[] {
  const present = readdirSync(dir).filter((f) => f.endsWith('.kt'))
  const bad = present.filter((f) => !(f in pin.files))
  for (const [file, want] of Object.entries(pin.files)) {
    let text: string
    try {
      text = readFileSync(new URL(file, dir), 'utf8')
    } catch {
      bad.push(file)
      continue
    }
    if (sha256(text) !== want) bad.push(file)
  }
  return bad.sort()
}

async function get(url: string): Promise<Response> {
  const headers: Record<string, string> = {}
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  return res
}

async function pin(commit: string): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error('pin takes a full 40-character commit hash')
  const listing = (await (
    await get(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${commit}`
    )
  ).json()) as { name: string; type: string }[]
  const names = listing
    .filter((e) => e.type === 'file' && e.name.endsWith('.kt'))
    .map((e) => e.name)
    .sort()
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.kt')))
    rmSync(new URL(f, dir))
  const files: Record<string, string> = {}
  for (const name of names) {
    const text = await (
      await get(
        `https://raw.githubusercontent.com/${repo}/${commit}/${path}/${name}`
      )
    ).text()
    writeFileSync(new URL(name, dir), text)
    files[name] = sha256(text)
  }
  const out: Pin = { repo, path, commit, files }
  writeFileSync(new URL('PIN.json', dir), JSON.stringify(out, null, 2) + '\n')
  console.log(`pinned ${names.length} files at ${commit}`)
}

if (import.meta.main) {
  const [cmd, commit] = process.argv.slice(2)
  if (cmd !== 'pin' || !commit) {
    console.error('usage: node scripts/androidx.ts pin <commit>')
    process.exit(2)
  }
  await pin(commit)
}
