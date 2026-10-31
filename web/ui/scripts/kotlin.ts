// Reads the token objects in androidx's generated Kotlin token files: each
// `internal object XTokens { ... }` and its `val Name = <expr>` properties,
// written either as `val Name = expr`, `const val Name = expr` or
// `inline val Name: Type get() = expr`. Expressions are returned as text,
// whitespace collapsed; tokens.ts decides what they mean.

export type Property = { name: string; expr: string; line: number }
export type TokenObject = { name: string; file: string; props: Property[] }

const objectStart = /^internal object (\w+) \{$/
const property =
  /^\s*(?:inline |const )?val (\w+)(?:\s*:\s*[\w.]+)?\s*(?:get\(\)\s*)?=\s*(.*)$/

export function parseTokenFile(file: string, text: string): TokenObject[] {
  const lines = text.split('\n')
  const objects: TokenObject[] = []
  let current: TokenObject | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const start = objectStart.exec(line)
    if (start) {
      current = { name: start[1]!, file, props: [] }
      objects.push(current)
      continue
    }
    if (!current) continue
    if (line === '}') {
      current = undefined
      continue
    }
    // A getter's type and body can sit on two lines.
    let source = line
    if (/^\s*inline val \w+\s*:\s*[\w.]+\s*$/.test(line))
      source = `${line} ${lines[++i]!.trim()}`
    const m = property.exec(source)
    if (!m) continue
    // Read on while parentheses are open, or until the expression starts.
    let expr = m[2]!.trim()
    const at = i + 1
    while (expr === '' || depth(expr) > 0) {
      if (++i >= lines.length)
        throw new Error(`${file}:${at}: unterminated expression`)
      expr += ' ' + lines[i]!.trim()
    }
    current.props.push({ name: m[1]!, expr: collapse(expr), line: at })
  }
  return objects
}

function depth(expr: string): number {
  let d = 0
  for (const c of expr) d += c === '(' ? 1 : c === ')' ? -1 : 0
  return d
}

const collapse = (expr: string) =>
  expr
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,?\s*\)/g, ')')
    .trim()
