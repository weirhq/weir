/** Widths the server resizes artwork to; a request rounds up to one. */
const widths = [160, 320, 480, 780, 1280, 1920]

/** A srcset for a signed artwork URL, or undefined when there's no picture. */
export function srcSet(
  url: string | undefined,
  upTo = 780
): string | undefined {
  if (!url) return undefined
  return widths
    .filter((w) => w <= upTo)
    .map((w) => `${url}&w=${w} ${w}w`)
    .join(', ')
}

export function sized(url: string, width: number): string {
  return `${url}&w=${width}`
}
