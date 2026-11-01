import {
  addDays,
  addMonths,
  dateInputFormat,
  daysInMonth,
  firstDayOfWeek,
  parseDigits,
  parseIso,
  toDigits,
  toIso,
  weekday,
  weekdayNames,
  withDelimiters
} from './calendar'

it('reads and writes ISO dates, refusing ones that never happen', () => {
  expect(parseIso('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
  expect(parseIso('2023-02-29')).toBeNull()
  expect(parseIso('2026-13-01')).toBeNull()
  expect(parseIso('nonsense')).toBeNull()
  expect(toIso({ year: 987, month: 3, day: 4 })).toBe('0987-03-04')
})

it('counts days, weekdays and steps through months and days', () => {
  expect(daysInMonth(2024, 2)).toBe(29)
  expect(daysInMonth(2100, 2)).toBe(28)
  expect(weekday({ year: 2026, month: 11, day: 1 })).toBe(7)
  expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
  expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  expect(addDays({ year: 2026, month: 2, day: 28 }, 1)).toEqual({
    year: 2026,
    month: 3,
    day: 1
  })
})

it('takes the week and its names from the locale', () => {
  expect(firstDayOfWeek('en-US')).toBe(7)
  expect(firstDayOfWeek('en-GB')).toBe(1)
  const names = weekdayNames('en-US')
  expect(names[0]).toEqual(['Sunday', 'S'])
  expect(weekdayNames('en-GB')[0]![0]).toBe('Monday')
})

it('makes a typed-date pattern for each locale and reads digits by it', () => {
  const us = dateInputFormat('en-US')
  expect(us).toEqual({ pattern: 'MM/dd/yyyy', delimiter: '/' })
  expect(dateInputFormat('de-DE')).toEqual({
    pattern: 'dd.MM.yyyy',
    delimiter: '.'
  })
  expect(dateInputFormat('ja-JP')).toEqual({
    pattern: 'yyyy/MM/dd',
    delimiter: '/'
  })
  expect(parseDigits('12252026', us)).toEqual({
    year: 2026,
    month: 12,
    day: 25
  })
  expect(parseDigits('02302026', us)).toBeNull()
  expect(parseDigits('1225', us)).toBeNull()
  expect(toDigits({ year: 2026, month: 1, day: 5 }, us)).toBe('01052026')
  expect(withDelimiters('1225', us)).toBe('12/25')
  expect(withDelimiters('12252', us)).toBe('12/25/2')
  expect(withDelimiters('12', us)).toBe('12')
})
