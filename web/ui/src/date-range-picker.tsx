import { Dialog as Radix } from 'radix-ui'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Button } from './button'
import {
  addDays,
  addMonths,
  compare,
  daysInMonth,
  firstDayOfWeek,
  formatDate,
  formatLongDate,
  formatMonthYear,
  formatNumber,
  parseIso,
  sameDay,
  toIso,
  today as getToday,
  weekday,
  weekdayNames,
  type CalendarDate
} from './calendar'
import {
  cx,
  datePickerStrings,
  TypedDate,
  type DatePickerStrings,
  type PartProps
} from './date-picker'
import styles from './date-picker.module.css'
import { IconButton } from './icon-button'
import { useReturnFocus } from './return-focus'
import { StateLayer } from './state-layer'
import { Tooltip } from './tooltip'
import './tokens/date-picker-modal.gen.css'
import './tokens/date-input-modal.gen.css'

export type DateRange = { start: string | null; end: string | null }

export type DateRangePickerProps = {
  /** The chosen range, as ISO dates; either end may be null. */
  value: DateRange
  onValueChange: (value: DateRange) => void
  mode?: 'picker' | 'input'
  onModeChange?: (mode: 'picker' | 'input') => void
  yearRange?: [number, number]
  isSelectable?: (date: string) => boolean
  locale?: string
  showModeToggle?: boolean
  strings?: Partial<DatePickerStrings>
  className?: string
}

const monthIndex = (year: number, month: number) => year * 12 + month - 1
const fromIndex = (i: number) => ({
  year: Math.floor(i / 12),
  month: (i % 12) + 1
})

/**
 * An M3 date range picker: months that scroll, the range banded across
 * them, or two fields to type the ends in. It fills its box's height.
 */
export function DateRangePicker({
  value,
  onValueChange,
  mode: controlledMode,
  onModeChange,
  yearRange = [1900, 2100],
  isSelectable,
  locale,
  showModeToggle = true,
  strings: given,
  className
}: DateRangePickerProps) {
  const strings = { ...datePickerStrings, ...given }
  const [ownMode, setOwnMode] = useState<'picker' | 'input'>('picker')
  const mode = controlledMode ?? ownMode
  const [entered, setEntered] = useState<'picker' | 'input'>()
  const setMode = (m: 'picker' | 'input') => {
    setOwnMode(m)
    setEntered(m)
    onModeChange?.(m)
  }
  const start = parseIso(value.start)
  const end = start ? parseIso(value.end) : null
  const allowed = (d: CalendarDate) =>
    d.year >= yearRange[0] &&
    d.year <= yearRange[1] &&
    (isSelectable?.(toIso(d)) ?? true)
  const set = (s: CalendarDate | null, e: CalendarDate | null) =>
    onValueChange({ start: s && toIso(s), end: e && toIso(e) })
  return (
    <div
      className={cx(
        styles.picker,
        styles.range,
        'md-comp-date-picker-modal',
        className
      )}
    >
      <div className={cx(styles.header, styles.rangeHeader)}>
        <p className={styles.title}>
          {mode === 'picker' ? strings.rangeTitle : strings.rangeInputTitle}
        </p>
        <div className={styles.headlineRow}>
          <p
            className={styles.rangeHeadline}
            aria-live="polite"
            aria-label={`${strings.startDate}: ${start ? formatLongDate(start, locale) : '—'}, ${strings.endDate}: ${end ? formatLongDate(end, locale) : '—'}`}
          >
            <span>{start ? formatDate(start, locale) : strings.startDate}</span>
            <span>-</span>
            <span>{end ? formatDate(end, locale) : strings.endDate}</span>
          </p>
          {showModeToggle && (
            <span className={styles.toggle}>
              <Tooltip
                text={
                  mode === 'picker'
                    ? strings.switchToInput
                    : strings.switchToCalendar
                }
              >
                <IconButton
                  icon={mode === 'picker' ? 'edit' : 'date_range'}
                  label={
                    mode === 'picker'
                      ? strings.switchToInput
                      : strings.switchToCalendar
                  }
                  onClick={() =>
                    setMode(mode === 'picker' ? 'input' : 'picker')
                  }
                />
              </Tooltip>
            </span>
          )}
        </div>
        <hr className={styles.divider} />
      </div>
      <div
        key={mode}
        className={cx(
          styles.rangeBody,
          entered === 'input' && mode === 'input' && styles.enterInput,
          entered === 'picker' && mode === 'picker' && styles.enterPicker
        )}
      >
        {mode === 'picker' ? (
          <Months
            start={start}
            end={end}
            onPick={(d) => {
              // updateDateSelection: a fresh start, unless this ends the range.
              if (start && !end && compare(d, start) >= 0) set(start, d)
              else set(d, null)
            }}
            yearRange={yearRange}
            allowed={allowed}
            locale={locale}
            strings={strings}
          />
        ) : (
          <div className={cx(styles.input, styles.rangeInput)}>
            <TypedDate
              label={strings.startDate}
              initial={start}
              onChange={(d) =>
                set(d, d && end && compare(d, end) <= 0 ? end : null)
              }
              check={(d) =>
                end && compare(d, end) > 0 ? strings.invalidRange : ''
              }
              yearRange={yearRange}
              allowed={allowed}
              locale={locale}
              strings={strings}
            />
            <TypedDate
              label={strings.endDate}
              initial={end}
              onChange={(d) => set(start, d)}
              check={(d) =>
                !start || compare(d, start) < 0 ? strings.invalidRange : ''
              }
              yearRange={yearRange}
              allowed={allowed}
              locale={locale}
              strings={strings}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function Months({
  start,
  end,
  onPick,
  yearRange,
  allowed,
  locale,
  strings
}: Omit<PartProps, 'selected'> & {
  start: CalendarDate | null
  end: CalendarDate | null
  onPick: (d: CalendarDate) => void
}) {
  const [today] = useState(getToday)
  const opening = start ?? today
  const first = monthIndex(yearRange[0], 1)
  const last = monthIndex(yearRange[1], 12)
  const clamp = (i: number) => Math.min(last, Math.max(first, i))
  // Months are rendered in a window that grows as it's scrolled near an end.
  const [span, setSpan] = useState(() => {
    const at = clamp(monthIndex(opening.year, opening.month))
    return { from: clamp(at - 2), to: clamp(at + 6), at }
  })
  const [focused, setFocused] = useState<CalendarDate>(opening)
  const moveFocus = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const prepended = useRef<number | null>(null)
  const names = useMemo(() => weekdayNames(locale), [locale])
  const firstDay = useMemo(() => firstDayOfWeek(locale), [locale])

  // Open at the start's month (or today's), once.
  const openAt = useRef(span.at)
  useLayoutEffect(() => {
    const root = list.current
    const el = root?.querySelector<HTMLElement>(
      `[data-month="${openAt.current}"]`
    )
    if (root && el) root.scrollTop = el.offsetTop - root.offsetTop
  }, [])

  // Months added above push the view down; take it back up by as much.
  useLayoutEffect(() => {
    if (prepended.current === null || !list.current) return
    list.current.scrollTop += list.current.scrollHeight - prepended.current
    prepended.current = null
  })

  useEffect(() => {
    const root = list.current
    if (!root) return
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          if (e.target === top.current && span.from > first) {
            prepended.current = root.scrollHeight
            setSpan((w) => ({ ...w, from: clamp(w.from - 6) }))
          }
          if (e.target === bottom.current && span.to < last)
            setSpan((w) => ({ ...w, to: clamp(w.to + 6) }))
        }
      },
      { root, rootMargin: '400px 0px' }
    )
    if (top.current) seen.observe(top.current)
    if (bottom.current) seen.observe(bottom.current)
    return () => seen.disconnect()
  })

  useLayoutEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    list.current
      ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
      ?.focus()
  })

  const onKeyDown = (e: KeyboardEvent) => {
    const moves: Record<string, () => CalendarDate> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => {
        const m = addMonths(focused.year, focused.month, -1)
        return {
          ...m,
          day: Math.min(focused.day, daysInMonth(m.year, m.month))
        }
      },
      PageDown: () => {
        const m = addMonths(focused.year, focused.month, 1)
        return {
          ...m,
          day: Math.min(focused.day, daysInMonth(m.year, m.month))
        }
      }
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    const next = move()
    const i = monthIndex(next.year, next.month)
    if (i < first || i > last) return
    if (i < span.from) {
      prepended.current = list.current?.scrollHeight ?? null
      setSpan((w) => ({ ...w, from: clamp(i - 1) }))
    }
    if (i > span.to) setSpan((w) => ({ ...w, to: clamp(i + 1) }))
    setFocused(next)
    moveFocus.current = true
  }

  const inBand = (d: CalendarDate) =>
    !!start && !!end && compare(d, start) >= 0 && compare(d, end) <= 0
  const months = Array.from({ length: span.to - span.from + 1 }, (_, k) =>
    fromIndex(span.from + k)
  )

  return (
    <>
      <div className={styles.week} aria-hidden>
        {names.map(([long, narrow]) => (
          <span key={long} className={styles.weekday} title={long}>
            {narrow}
          </span>
        ))}
      </div>
      <div ref={list} className={styles.months} onKeyDown={onKeyDown}>
        <div ref={top} />
        {months.map(({ year, month }) => {
          const lead = (weekday({ year, month, day: 1 }) - firstDay + 7) % 7
          const length = daysInMonth(year, month)
          const label = formatMonthYear(year, month, locale)
          return (
            <section
              key={`${year}-${month}`}
              data-month={monthIndex(year, month)}
            >
              <h3 className={styles.subhead}>{label}</h3>
              <div role="grid" aria-label={label} className={styles.month}>
                {Array.from({ length: 6 }, (_, w) => (
                  <div key={w} role="row" className={styles.week}>
                    {Array.from({ length: 7 }, (_, d) => {
                      const day = w * 7 + d - lead + 1
                      if (day < 1 || day > length)
                        return (
                          <span
                            key={d}
                            role="gridcell"
                            className={styles.cell}
                          />
                        )
                      const date = { year, month, day }
                      const isStart = sameDay(date, start)
                      const isEnd = sameDay(date, end)
                      const banded = inBand(date)
                      const isToday = sameDay(date, today)
                      return (
                        <span
                          key={d}
                          role="gridcell"
                          className={cx(
                            styles.cell,
                            banded && !isStart && !isEnd && styles.band,
                            isStart && !!end && !isEnd && styles.bandStart,
                            isEnd && !isStart && styles.bandEnd
                          )}
                        >
                          <button
                            type="button"
                            className={cx(
                              styles.day,
                              isToday && !isStart && !isEnd && styles.today
                            )}
                            tabIndex={sameDay(date, focused) ? 0 : -1}
                            aria-pressed={isStart || isEnd}
                            aria-current={isToday ? 'date' : undefined}
                            aria-label={
                              formatLongDate(date, locale) +
                              (banded && !isStart && !isEnd
                                ? `, ${strings.inRange}`
                                : '')
                            }
                            disabled={!allowed(date)}
                            onClick={() => {
                              setFocused(date)
                              onPick(date)
                            }}
                          >
                            {formatNumber(day, locale)}
                            <StateLayer />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
        <div ref={bottom} />
      </div>
    </>
  )
}

export type DateRangePickerDialogProps = Omit<
  DateRangePickerProps,
  'value' | 'onValueChange'
> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: DateRange
  /** OK: the chosen range. */
  onConfirm: (value: DateRange) => void
  children?: ReactNode
}

/**
 * An M3 date range picker in a modal dialog, with Cancel and OK. OK waits
 * for both ends.
 */
export function DateRangePickerDialog({
  open,
  onOpenChange,
  strings: given,
  ...props
}: DateRangePickerDialogProps) {
  const strings = { ...datePickerStrings, ...given }
  const returnFocus = useReturnFocus()
  const titleId = useId()
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className={styles.scrim} />
        <Radix.Content
          className={cx(styles.dialog, 'md-comp-date-picker-modal')}
          aria-describedby={undefined}
          aria-labelledby={titleId}
          {...returnFocus}
          onOpenAutoFocus={(e) => {
            returnFocus.onOpenAutoFocus()
            e.preventDefault()
            const content = e.currentTarget as HTMLElement
            content
              .querySelector<HTMLElement>('button[tabindex="0"], input')
              ?.focus()
          }}
        >
          <Radix.Title id={titleId} className={styles.hidden}>
            {strings.rangeTitle}
          </Radix.Title>
          <RangeDialogBody
            {...props}
            strings={strings}
            close={() => onOpenChange(false)}
          />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}

// Mounted with each opening, so the draft starts from the value given.
function RangeDialogBody({
  value,
  onConfirm,
  close,
  children,
  strings,
  ...props
}: Omit<DateRangePickerDialogProps, 'open' | 'onOpenChange' | 'strings'> & {
  strings: DatePickerStrings
  close: () => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <>
      <DateRangePicker
        {...props}
        strings={strings}
        value={draft}
        onValueChange={setDraft}
      />
      {children}
      <div className={styles.buttons}>
        <Button variant="text" onClick={close}>
          {strings.dismiss}
        </Button>
        <Button
          variant="text"
          disabled={!parseIso(draft.start) || !parseIso(draft.end)}
          onClick={() => {
            onConfirm(draft)
            close()
          }}
        >
          {strings.confirm}
        </Button>
      </div>
    </>
  )
}
