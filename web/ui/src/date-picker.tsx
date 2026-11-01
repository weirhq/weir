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
  dateInputFormat,
  daysInMonth,
  firstDayOfWeek,
  formatDate,
  formatLongDate,
  formatMonthYear,
  formatNumber,
  parseDigits,
  parseIso,
  sameDay,
  toDigits,
  toIso,
  today as getToday,
  weekday,
  weekdayNames,
  withDelimiters,
  type CalendarDate
} from './calendar'
import styles from './date-picker.module.css'
import { Icon } from './icon'
import { IconButton } from './icon-button'
import { useReturnFocus } from './return-focus'
import { StateLayer } from './state-layer'
import { TextField } from './text-field'
import { Tooltip } from './tooltip'
import './tokens/date-picker-modal.gen.css'
import './tokens/date-input-modal.gen.css'

export const cx = (...c: (string | false | undefined)[]) =>
  c.filter(Boolean).join(' ')

/** Compose's English strings, for an app to translate. */
export const datePickerStrings = {
  title: 'Select date',
  headline: 'Selected date',
  inputTitle: 'Select date',
  inputHeadline: 'Entered date',
  inputLabel: 'Date',
  switchToInput: 'Switch to text input mode',
  switchToCalendar: 'Switch to calendar input mode',
  switchToYears: 'Switch to selecting a year',
  switchToDays:
    'Swipe to select a year, or tap to switch back to selecting a day',
  nextMonth: 'Change to next month',
  previousMonth: 'Change to previous month',
  navigateToYear: 'Navigate to year %1$s',
  today: 'Today',
  invalidPattern: 'Date does not match expected pattern: %1$s',
  invalidYearRange: 'Date out of expected year range %1$s - %2$s',
  invalidNotAllowed: 'Date not allowed: %1$s',
  confirm: 'OK',
  dismiss: 'Cancel',
  rangeTitle: 'Select dates',
  rangeInputTitle: 'Enter dates',
  startDate: 'Start date',
  endDate: 'End date',
  inRange: 'In range',
  invalidRange: 'Invalid date range input'
}

export type DatePickerStrings = typeof datePickerStrings

export const fill = (template: string, ...values: string[]) =>
  values.reduce((s, v, i) => s.replace(`%${i + 1}$s`, v), template)

export type DatePickerProps = {
  /** The chosen date, as "2026-11-01", or null. */
  value: string | null
  onValueChange: (value: string | null) => void
  /** Choosing on the calendar, or typing the date. */
  mode?: 'picker' | 'input'
  onModeChange?: (mode: 'picker' | 'input') => void
  /** The years it offers; 1900 to 2100 by default. */
  yearRange?: [number, number]
  /** Whether a date can be chosen; all can by default. */
  isSelectable?: (date: string) => boolean
  /** A BCP 47 tag; the browser's language by default. */
  locale?: string
  showModeToggle?: boolean
  strings?: Partial<DatePickerStrings>
  className?: string
}

/** An M3 date picker: a calendar, or a field to type the date in. */
export function DatePicker({
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
}: DatePickerProps) {
  const strings = { ...datePickerStrings, ...given }
  const [ownMode, setOwnMode] = useState<'picker' | 'input'>('picker')
  const mode = controlledMode ?? ownMode
  // Which mode was switched to, for its entrance; none on first show.
  const [entered, setEntered] = useState<'picker' | 'input'>()
  const setMode = (m: 'picker' | 'input') => {
    setOwnMode(m)
    setEntered(m)
    onModeChange?.(m)
  }
  const selected = parseIso(value)
  const allowed = (d: CalendarDate) =>
    d.year >= yearRange[0] &&
    d.year <= yearRange[1] &&
    (isSelectable?.(toIso(d)) ?? true)
  const headline = selected
    ? formatDate(selected, locale)
    : mode === 'picker'
      ? strings.headline
      : strings.inputHeadline
  return (
    <div className={cx(styles.picker, 'md-comp-date-picker-modal', className)}>
      <div className={styles.header}>
        <p className={styles.title}>
          {mode === 'picker' ? strings.title : strings.inputTitle}
        </p>
        <div className={styles.headlineRow}>
          <p
            className={styles.headline}
            aria-live="polite"
            aria-label={selected ? formatLongDate(selected, locale) : undefined}
          >
            {headline}
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
          entered === 'input' && mode === 'input' && styles.enterInput,
          entered === 'picker' && mode === 'picker' && styles.enterPicker
        )}
      >
        {mode === 'picker' ? (
          <Calendar
            selected={selected}
            onSelect={(d) => onValueChange(toIso(d))}
            yearRange={yearRange}
            allowed={allowed}
            locale={locale}
            strings={strings}
          />
        ) : (
          <DateInput
            selected={selected}
            onChange={(d) => onValueChange(d ? toIso(d) : null)}
            yearRange={yearRange}
            allowed={allowed}
            locale={locale}
            strings={strings}
          />
        )}
      </div>
    </div>
  )
}

export type PartProps = {
  selected: CalendarDate | null
  yearRange: [number, number]
  allowed: (d: CalendarDate) => boolean
  locale: string | undefined
  strings: DatePickerStrings
}

function Calendar({
  selected,
  onSelect,
  yearRange,
  allowed,
  locale,
  strings
}: PartProps & { onSelect: (d: CalendarDate) => void }) {
  const [today] = useState(getToday)
  const start = selected ?? today
  const [shown, setShown] = useState({ year: start.year, month: start.month })
  const [direction, setDirection] = useState<'next' | 'previous'>()
  const [years, setYears] = useState(false)
  // The day that keyboard focus is on, which takes Tab.
  const [focused, setFocused] = useState<CalendarDate>(start)
  const moveFocus = useRef(false)
  const grid = useRef<HTMLDivElement>(null)
  const yearList = useRef<HTMLUListElement>(null)
  const names = useMemo(() => weekdayNames(locale), [locale])
  const first = useMemo(() => firstDayOfWeek(locale), [locale])

  const inRange = (year: number, month: number) => {
    const index = year * 12 + month
    return index >= yearRange[0] * 12 + 1 && index <= yearRange[1] * 12 + 12
  }
  const show = (year: number, month: number, from?: 'next' | 'previous') => {
    if (!inRange(year, month)) return
    setDirection(from)
    setShown({ year, month })
  }
  const step = (by: number) => {
    const next = addMonths(shown.year, shown.month, by)
    show(next.year, next.month, by > 0 ? 'next' : 'previous')
  }

  // Keyboard focus follows the focused day once it's on screen.
  useLayoutEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus()
  })
  // The year list opens on the shown year, focused.
  useEffect(() => {
    if (!years) return
    const current = yearList.current?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]'
    )
    current?.scrollIntoView?.({ block: 'center' })
    current?.focus()
  }, [years])

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
    if (!inRange(next.year, next.month)) return
    setFocused(next)
    moveFocus.current = true
    if (next.year !== shown.year || next.month !== shown.month)
      show(
        next.year,
        next.month,
        compare(next, focused) > 0 ? 'next' : 'previous'
      )
  }

  // The cells of the shown month: blanks, then its days, six weeks.
  const lead = (weekday({ ...shown, day: 1 }) - first + 7) % 7
  const length = daysInMonth(shown.year, shown.month)
  const tabbable =
    focused.year === shown.year && focused.month === shown.month
      ? focused.day
      : selected &&
          selected.year === shown.year &&
          selected.month === shown.month
        ? selected.day
        : today.year === shown.year && today.month === shown.month
          ? today.day
          : 1
  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = w * 7 + d - lead + 1
      return day >= 1 && day <= length ? day : null
    })
  )
  const previous = addMonths(shown.year, shown.month, -1)
  const next = addMonths(shown.year, shown.month, 1)

  return (
    <div className={cx(years && styles.expanded)}>
      <div className={styles.nav}>
        <Button
          variant="text"
          aria-expanded={years}
          title={years ? strings.switchToDays : strings.switchToYears}
          onClick={() => setYears(!years)}
        >
          <span aria-live="polite">
            {formatMonthYear(shown.year, shown.month, locale)}
          </span>
          <Icon name="arrow_drop_down" className={styles.arrow} />
        </Button>
        {!years && (
          <span className={styles.arrows}>
            <Tooltip text={strings.previousMonth}>
              <IconButton
                icon="keyboard_arrow_left"
                label={strings.previousMonth}
                disabled={!inRange(previous.year, previous.month)}
                onClick={() => step(-1)}
              />
            </Tooltip>
            <Tooltip text={strings.nextMonth}>
              <IconButton
                icon="keyboard_arrow_right"
                label={strings.nextMonth}
                disabled={!inRange(next.year, next.month)}
                onClick={() => step(1)}
              />
            </Tooltip>
          </span>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.week} aria-hidden>
          {names.map(([long, narrow]) => (
            <span key={long} className={styles.weekday} title={long}>
              {narrow}
            </span>
          ))}
        </div>
        <div
          ref={grid}
          key={`${shown.year}-${shown.month}`}
          role="grid"
          aria-label={formatMonthYear(shown.year, shown.month, locale)}
          className={cx(
            styles.month,
            direction === 'next' && styles.fromNext,
            direction === 'previous' && styles.fromPrevious
          )}
          onKeyDown={onKeyDown}
        >
          {weeks.map((days, w) => (
            <div key={w} role="row" className={styles.week}>
              {days.map((day, d) => {
                if (day === null)
                  return (
                    <span key={d} role="gridcell" className={styles.cell} />
                  )
                const date = { ...shown, day }
                const isToday = sameDay(date, today)
                const isSelected = sameDay(date, selected)
                return (
                  <span key={d} role="gridcell" className={styles.cell}>
                    <button
                      type="button"
                      className={cx(
                        styles.day,
                        isToday && !isSelected && styles.today
                      )}
                      tabIndex={day === tabbable ? 0 : -1}
                      aria-pressed={isSelected}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={formatLongDate(date, locale)}
                      disabled={!allowed(date)}
                      onClick={() => {
                        setFocused(date)
                        onSelect(date)
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
        {years && (
          <div className={styles.years}>
            <ul
              ref={yearList}
              className={styles.yearGrid}
              aria-label={strings.switchToYears}
            >
              {Array.from(
                { length: yearRange[1] - yearRange[0] + 1 },
                (_, i) => {
                  const year = yearRange[0] + i
                  const text = formatNumber(year, locale)
                  return (
                    <li key={year}>
                      <button
                        type="button"
                        className={cx(
                          styles.year,
                          year === today.year &&
                            year !== shown.year &&
                            styles.today
                        )}
                        aria-pressed={year === shown.year}
                        aria-label={fill(strings.navigateToYear, text)}
                        onClick={() => {
                          setYears(false)
                          show(year, shown.month)
                        }}
                      >
                        {text}
                        <StateLayer />
                      </button>
                    </li>
                  )
                }
              )}
            </ul>
            <hr className={styles.divider} />
          </div>
        )}
      </div>
    </div>
  )
}

function DateInput({
  selected,
  onChange,
  ...props
}: PartProps & { onChange: (d: CalendarDate | null) => void }) {
  return (
    <div className={styles.input}>
      <TypedDate
        {...props}
        label={props.strings.inputLabel}
        initial={selected}
        onChange={onChange}
      />
    </div>
  )
}

/**
 * A field for typing a date in the locale's pattern: digits only, its
 * delimiters put in as it's typed, and no verdict until every digit is in
 * (DateInputTextField). [check] can add a last test, as the range does.
 */
export function TypedDate({
  label,
  initial,
  onChange,
  yearRange,
  allowed,
  locale,
  strings,
  check,
  className
}: Omit<PartProps, 'selected'> & {
  label: string
  initial: CalendarDate | null
  onChange: (d: CalendarDate | null) => void
  check?: (d: CalendarDate) => string
  className?: string
}) {
  const format = useMemo(() => dateInputFormat(locale), [locale])
  const bare = format.pattern.replaceAll(format.delimiter, '')
  const [digits, setDigits] = useState(() =>
    initial ? toDigits(initial, format) : ''
  )
  const [error, setError] = useState('')
  const pattern = format.pattern.toUpperCase()
  const update = (typed: string) => {
    const next = typed.replace(/\D/g, '').slice(0, bare.length)
    setDigits(next)
    if (next.length < bare.length) {
      setError('')
      onChange(null)
      return
    }
    const date = parseDigits(next, format)
    const problem = !date
      ? fill(strings.invalidPattern, pattern)
      : date.year < yearRange[0] || date.year > yearRange[1]
        ? fill(
            strings.invalidYearRange,
            formatNumber(yearRange[0], locale),
            formatNumber(yearRange[1], locale)
          )
        : !allowed(date)
          ? fill(strings.invalidNotAllowed, formatDate(date, locale))
          : (check?.(date) ?? '')
    setError(problem)
    onChange(problem ? null : date)
  }
  return (
    <TextField
      className={className}
      label={label}
      placeholder={pattern}
      inputMode="numeric"
      autoComplete="off"
      value={withDelimiters(digits, format)}
      error={error || undefined}
      onChange={(e) => update(e.target.value)}
    />
  )
}

export type DatePickerDialogProps = Omit<
  DatePickerProps,
  'value' | 'onValueChange'
> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The date it opens on, as "2026-11-01", or null. */
  value: string | null
  /** OK: the chosen date. */
  onConfirm: (value: string | null) => void
  /** Extra content under the picker, before the buttons. */
  children?: ReactNode
}

/**
 * An M3 date picker in a modal dialog, with Cancel and OK. OK waits for a
 * date; Cancel, Escape and the scrim leave the value as it was.
 */
export function DatePickerDialog({
  open,
  onOpenChange,
  strings: given,
  ...props
}: DatePickerDialogProps) {
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
          // Open on the chosen day, or today, rather than the first button.
          onOpenAutoFocus={(e) => {
            returnFocus.onOpenAutoFocus()
            e.preventDefault()
            const content = e.currentTarget as HTMLElement
            content
              .querySelector<HTMLElement>('[role="grid"] [tabindex="0"], input')
              ?.focus()
          }}
        >
          <Radix.Title id={titleId} className={styles.hidden}>
            {strings.title}
          </Radix.Title>
          <DialogBody
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
function DialogBody({
  value,
  onConfirm,
  close,
  children,
  strings,
  ...props
}: Omit<DatePickerDialogProps, 'open' | 'onOpenChange' | 'strings'> & {
  strings: DatePickerStrings
  close: () => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <>
      <DatePicker
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
          disabled={!parseIso(draft)}
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
