// Turns a Compose spring (damping ratio, stiffness, unit mass) into a CSS
// `linear()` easing and the duration it takes to settle, since CSS has no
// springs. The motion starts at rest and travels from 0 to 1.

export type Spring = { damping: number; stiffness: number }

// Settled once the remaining distance stays under this fraction.
const settled = 0.001
const samples = 48

// Distance still to travel at time t (seconds): 1 at the start, 0 at rest.
function remaining({ damping: z, stiffness: k }: Spring, t: number): number {
  const w = Math.sqrt(k)
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z)
    return (
      Math.exp(-z * w * t) *
      (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
    )
  }
  if (z === 1) return (1 + w * t) * Math.exp(-w * t)
  const r1 = -w * (z - Math.sqrt(z * z - 1))
  const r2 = -w * (z + Math.sqrt(z * z - 1))
  return (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1)
}

// Seconds until the motion stays within `settled` of the end.
export function settleTime(spring: Spring): number {
  const { damping: z, stiffness: k } = spring
  if (z < 1) {
    // The oscillation's envelope bounds it from then on.
    const w = Math.sqrt(k)
    const amplitude = 1 / Math.sqrt(1 - z * z)
    return Math.log(amplitude / settled) / (z * w)
  }
  // Critically and over-damped motion only falls, so find where it crosses.
  let t = 0
  while (remaining(spring, t) > settled) t += 0.001
  return t
}

const round = (n: number) => String(Math.round(n * 10000) / 10000)

export function springEasing(spring: Spring): { easing: string; ms: number } {
  const seconds = settleTime(spring)
  const points = Array.from({ length: samples + 1 }, (_, i) =>
    i === samples ? '1' : round(1 - remaining(spring, (seconds * i) / samples))
  )
  return {
    easing: `linear(${points.join(', ')})`,
    ms: Math.round(seconds * 1000)
  }
}
