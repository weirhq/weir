// Dates for the date pickers, as Compose's CalendarModel provides them:
// whole days (no time or zone), locale names and formats from Intl, and
// parsing typed dates. Dates cross the API as ISO strings, "2026-11-01".

export type CalendarDate = { year: number; month: number; day: number }

export function parseIso(iso: string | null | undefined): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  const date = { year: +m[1]!, month: +m[2]!, day: +m[3]! }
  return isReal(date) ? date : null
}

export const toIso = ({ year, month, day }: CalendarDate) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export const compare = (a: CalendarDate, b: CalendarDate) =>
  a.year - b.year || a.month - b.month || a.day - b.day

export const sameDay = (a: CalendarDate | null, b: CalendarDate | null) =>
  !!a && !!b && compare(a, b) === 0

export function today(): CalendarDate {
  const now = new Date()
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate()
  }
}

export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

export const isReal = (d: CalendarDate) =>
  d.month >= 1 &&
  d.month <= 12 &&
  d.day >= 1 &&
  d.day <= daysInMonth(d.year, d.month)

// The weekday as ISO numbers it: Monday 1 to Sunday 7.
export const weekday = ({ year, month, day }: CalendarDate) =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7

export function addMonths(year: number, month: number, by: number) {
  const index = year * 12 + (month - 1) + by
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

export function addDays(d: CalendarDate, by: number): CalendarDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + by))
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate()
  }
}

const utc = (d: CalendarDate) => new Date(Date.UTC(d.year, d.month - 1, d.day))

// Where the locale doesn't say, the regions that start the week on Sunday.
const sundayRegions = new Set(
  'US CA MX BR JP KR TW HK MO PH IN IL ZA SA AE QA KW BH OM JO EG PK BD NP TH ID KE ET ZW PE PA GT HN NI SV DO PR CO VE BZ JM TT BS'.split(
    ' '
  )
)

/** The first day of the week for the locale, as ISO numbers it (1 Monday, 7 Sunday). */
export function firstDayOfWeek(locale?: string): number {
  try {
    const l = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const info = l.getWeekInfo?.() ?? l.weekInfo
    if (info) return info.firstDay
    const region = l.maximize().region
    return region && sundayRegions.has(region) ? 7 : 1
  } catch {
    return 7
  }
}

/** The days of the week from its first, as [long name, narrow name]. */
export function weekdayNames(locale?: string): [string, string][] {
  const long = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: 'UTC'
  })
  const narrow = new Intl.DateTimeFormat(locale, {
    weekday: 'narrow',
    timeZone: 'UTC'
  })
  const first = firstDayOfWeek(locale)
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = utc({ year: 2024, month: 1, day: ((first - 1 + i) % 7) + 1 })
    return [long.format(d), narrow.format(d)]
  })
}

// DatePickerDefaults' skeletons: yMMMM, yMMMd and yMMMMEEEEd.
export const formatMonthYear = (year: number, month: number, locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(utc({ year, month, day: 1 }))

export const formatDate = (d: CalendarDate, locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(utc(d))

export const formatLongDate = (d: CalendarDate, locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    weekday: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(utc(d))

export const formatNumber = (n: number, locale?: string) =>
  new Intl.NumberFormat(locale, { useGrouping: false }).format(n)

export type DateInputFormat = { pattern: string; delimiter: string }

/**
 * The locale's numeric date as two-digit day and month and four-digit year
 * with one delimiter (datePatternAsInputFormat): "MM/dd/yyyy", "dd.MM.yyyy",
 * "yyyy-MM-dd" and so on.
 */
export function dateInputFormat(locale?: string): DateInputFormat {
  const parts = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC'
  }).formatToParts(utc({ year: 2024, month: 1, day: 31 }))
  const literal = parts.find((p) => p.type === 'literal')?.value.trim() ?? '/'
  const delimiter = ['/', '-', '.'].includes(literal[0] ?? '')
    ? literal[0]!
    : '/'
  const fields = { day: 'dd', month: 'MM', year: 'yyyy' } as Record<
    string,
    string
  >
  const pattern = parts
    .filter((p) => p.type in fields)
    .map((p) => fields[p.type])
    .join(delimiter)
  return { pattern, delimiter }
}

/** Reads the digits of a typed date (no delimiters) by the pattern. */
export function parseDigits(
  digits: string,
  format: DateInputFormat
): CalendarDate | null {
  const bare = format.pattern.replaceAll(format.delimiter, '')
  if (digits.length !== bare.length || !/^\d+$/.test(digits)) return null
  const take = (field: string) => {
    const at = bare.indexOf(field)
    return +digits.slice(at, at + field.length)
  }
  const date = { year: take('yyyy'), month: take('MM'), day: take('dd') }
  return isReal(date) ? date : null
}

/** A date's digits in the pattern's order, for the input. */
export function toDigits(d: CalendarDate, format: DateInputFormat): string {
  const bare = format.pattern.replaceAll(format.delimiter, '')
  return bare
    .replace('yyyy', String(d.year).padStart(4, '0'))
    .replace('MM', String(d.month).padStart(2, '0'))
    .replace('dd', String(d.day).padStart(2, '0'))
}

/** Digits shown with the delimiters put back, as DateVisualTransformation does. */
export function withDelimiters(
  digits: string,
  format: DateInputFormat
): string {
  const fields = format.pattern.split(format.delimiter)
  let out = ''
  let at = 0
  for (const [i, f] of fields.entries()) {
    const part = digits.slice(at, at + f.length)
    out += part
    at += f.length
    if (part.length === f.length && i < fields.length - 1 && digits.length > at)
      out += format.delimiter
  }
  return out
}
