import { Dialog as Radix } from 'radix-ui'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import { Button } from './button'
import { cx, fill } from './date-picker'
import { IconButton } from './icon-button'
import { useReturnFocus } from './return-focus'
import { focusRing, StateLayer } from './state-layer'
import styles from './time-picker.module.css'
import { Tooltip } from './tooltip'
import './tokens/time-picker.gen.css'
import './tokens/time-input.gen.css'

/** Compose's English strings, for an app to translate. */
export const timePickerStrings = {
  title: 'Select Time',
  inputTitle: 'Enter Time',
  selectPeriod: 'Select AM or PM',
  selectHour: 'Select hour',
  selectMinutes: 'Select minutes',
  hourSuffix: "%1$s o'clock",
  hour24Suffix: '%1$s hours',
  minuteSuffix: '%1$s minutes',
  hour: 'Hour',
  minute: 'Minute',
  hourError: 'Hour must be 1–12',
  hour24Error: 'Hour must be 0–23',
  minuteError: 'Minute must be 0–59',
  switchToInput: 'Switch to text input mode',
  switchToClock: 'Switch to clock mode',
  confirm: 'OK',
  dismiss: 'Cancel'
}

export type TimePickerStrings = typeof timePickerStrings

type Time = { hour: number; minute: number }
type Selection = 'hour' | 'minute'

function parseTime(value: string): Time {
  const m = /^(\d{1,2}):(\d{2})/.exec(value)
  return { hour: m ? +m[1]! % 24 : 0, minute: m ? +m[2]! % 60 : 0 }
}

const pad = (n: number) => String(n).padStart(2, '0')
const toValue = ({ hour, minute }: Time) => `${pad(hour)}:${pad(minute)}`

/** The hour as the clock shows it: 0 to 23, or 1 to 12. */
const displayHour = (hour: number, is24Hour: boolean) =>
  is24Hour ? hour : hour % 12 || 12

function uses24Hour(locale?: string) {
  const cycle = new Intl.DateTimeFormat(locale, {
    hour: 'numeric'
  }).resolvedOptions().hourCycle
  return cycle === 'h23' || cycle === 'h24'
}

function periodNames(locale?: string): [string, string] {
  const format = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hourCycle: 'h12',
    timeZone: 'UTC'
  })
  const name = (hour: number) =>
    format
      .formatToParts(Date.UTC(2000, 0, 1, hour))
      .find((p) => p.type === 'dayPeriod')?.value
  return [name(9) ?? 'AM', name(21) ?? 'PM']
}

// The locale's digits, as toLocalString gives them.
const formatDigits = (n: number, digits: number, locale?: string) =>
  new Intl.NumberFormat(locale, {
    minimumIntegerDigits: digits,
    useGrouping: false
  }).format(n)

function describe(
  n: number,
  selection: Selection,
  is24Hour: boolean,
  locale: string | undefined,
  strings: TimePickerStrings
) {
  const template =
    selection === 'minute'
      ? strings.minuteSuffix
      : is24Hour
        ? strings.hour24Suffix
        : strings.hourSuffix
  return fill(template, formatDigits(n, 1, locale))
}

export type TimePickerProps = {
  /** The time, as "14:05". */
  value: string
  onValueChange: (value: string) => void
  /** A 24-hour clock, or 12 hours with AM and PM; the locale's by default. */
  is24Hour?: boolean
  /** The time above the clock, or beside it; above by default. */
  layout?: 'vertical' | 'horizontal'
  /** A BCP 47 tag; the browser's language by default. */
  locale?: string
  strings?: Partial<TimePickerStrings>
  className?: string
}

/** An M3 time picker: the time, and a clock to set its hour and minutes. */
export function TimePicker({
  value,
  onValueChange,
  is24Hour,
  layout = 'vertical',
  locale,
  strings: given,
  className
}: TimePickerProps) {
  const strings = { ...timePickerStrings, ...given }
  const time = parseTime(value)
  const h24 = useMemo(() => is24Hour ?? uses24Hour(locale), [is24Hour, locale])
  const [selection, setSelection] = useState<Selection>('hour')
  const set = (t: Time) => onValueChange(toValue(t))
  return (
    <div
      className={cx(
        styles.picker,
        layout === 'horizontal' && styles.horizontal,
        'md-comp-time-picker',
        className
      )}
    >
      <div className={styles.display}>
        <div className={styles.numbers}>
          {(['hour', 'minute'] as const).map((part, i) => {
            const n =
              part === 'hour' ? displayHour(time.hour, h24) : time.minute
            return (
              <TimeSelector
                key={part}
                label={
                  part === 'hour' ? strings.selectHour : strings.selectMinutes
                }
                description={describe(n, part, h24, locale, strings)}
                selected={selection === part}
                onSelect={() => setSelection(part)}
                separated={i > 0}
              >
                {formatDigits(n, 2, locale)}
              </TimeSelector>
            )
          })}
        </div>
        {!h24 && (
          <PeriodToggle
            time={time}
            onChange={set}
            horizontal={layout === 'horizontal'}
            locale={locale}
            strings={strings}
          />
        )}
      </div>
      <ClockDial
        time={time}
        onChange={set}
        selection={selection}
        onSelectionChange={setSelection}
        is24Hour={h24}
        locale={locale}
        strings={strings}
      />
    </div>
  )
}

function TimeSelector({
  label,
  description,
  selected,
  onSelect,
  separated,
  children
}: {
  label: string
  description: string
  selected: boolean
  onSelect: () => void
  separated: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <>
      {separated && <Separator />}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-labelledby={`${id}-label ${id}-value`}
        className={cx(styles.selector, focusRing)}
        onClick={onSelect}
      >
        <StateLayer />
        <span id={`${id}-label`} className={styles.hidden}>
          {label}
        </span>
        <span id={`${id}-value`} className={styles.hidden}>
          {description}
        </span>
        <span aria-hidden>{children}</span>
      </button>
    </>
  )
}

const Separator = () => (
  <span className={styles.separator} aria-hidden>
    <span>:</span>
  </span>
)

function PeriodToggle({
  time,
  onChange,
  horizontal = false,
  disabled = false,
  locale,
  strings
}: {
  time: Time
  onChange: (t: Time) => void
  horizontal?: boolean
  /** Typing an invalid hour holds the period, as Compose does. */
  disabled?: boolean
  locale: string | undefined
  strings: TimePickerStrings
}) {
  const names = useMemo(() => periodNames(locale), [locale])
  const ref = useRef<HTMLDivElement>(null)
  const isPm = time.hour >= 12
  const choose = (pm: boolean) => {
    if (pm !== isPm && !disabled)
      onChange({ ...time, hour: time.hour + (pm ? 12 : -12) })
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
      return
    e.preventDefault()
    choose(!isPm)
    ref.current?.querySelector<HTMLElement>(`[data-pm="${!isPm}"]`)?.focus()
  }
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={strings.selectPeriod}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      className={cx(styles.period, horizontal && styles.horizontalPeriod)}
      onKeyDown={onKeyDown}
    >
      {[false, true].map((pm) => (
        <button
          key={String(pm)}
          type="button"
          role="radio"
          aria-checked={isPm === pm}
          tabIndex={isPm === pm ? 0 : -1}
          data-pm={pm}
          className={cx(styles.periodItem, focusRing)}
          onClick={() => choose(pm)}
        >
          <StateLayer />
          {names[+pm]}
        </button>
      ))}
    </div>
  )
}

/* The clock face: the hours or minutes round a 256dp dial, numbers 101dp
   from the centre and the 24-hour clock's 12 to 23 at 69dp, under a hand
   with a 48dp handle. Within 74dp of the centre picks the inner ring. */
const DIAL = 256
const OUTER = 101
const INNER = 69
const MAX_INNER_DISTANCE = 74
const TOUCH_SLOP = 8

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

function ClockDial({
  time,
  onChange,
  selection,
  onSelectionChange,
  is24Hour,
  locale,
  strings
}: {
  time: Time
  onChange: (t: Time) => void
  selection: Selection
  onSelectionChange: (s: Selection) => void
  is24Hour: boolean
  locale: string | undefined
  strings: TimePickerStrings
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isHour = selection === 'hour'
  const isPm = time.hour >= 12
  const inner = isHour && is24Hour && isPm
  // Degrees clockwise from 12. The hand keeps turning the short way round
  // rather than wrapping, so its angle is a running total.
  const target = isHour ? (time.hour % 12) * 30 : time.minute * 6
  const [angle, setAngle] = useState(target)
  const [dragging, setDragging] = useState(false)
  const settled = target + 360 * Math.round((angle - target) / 360)
  if (!dragging && angle !== settled) setAngle(settled)

  const press = useRef<{ x: number; y: number; dragging: boolean }>(null)
  const switchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(switchTimer.current), [])
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  })

  const select = (t: Time) => {
    if (t.hour !== time.hour || t.minute !== time.minute) onChange(t)
  }
  // The time at a point on the dial: the nearest hour, or the nearest
  // minute while dragging and five minutes on a tap.
  const pointAt = (e: PointerEvent) => {
    const box = ref.current!.getBoundingClientRect()
    const x = e.clientX - box.left - box.width / 2
    const y = e.clientY - box.top - box.height / 2
    const degrees = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360
    const distance = (Math.hypot(x, y) * DIAL) / box.width
    return { degrees, distance }
  }
  const timeAt = (degrees: number, distance: number, tap: boolean): Time => {
    if (!isHour) {
      const minute = tap
        ? (Math.round(degrees / 30) * 5) % 60
        : Math.round(degrees / 6) % 60
      return { ...time, minute }
    }
    const h = Math.round(degrees / 30) % 12
    const pm = is24Hour ? distance < MAX_INNER_DISTANCE : isPm
    return { ...time, hour: h + (pm ? 12 : 0) }
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    press.current = { x: e.clientX, y: e.clientY, dragging: false }
  }
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current
    if (!p) return
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < TOUCH_SLOP) return
      p.dragging = true
      setDragging(true)
    }
    const { degrees, distance } = pointAt(e)
    setAngle((a) => a + ((((degrees - a) % 360) + 540) % 360) - 180)
    select(timeAt(degrees, distance, false))
  }
  const onPointerUp = (e: PointerEvent) => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.dragging) {
      setDragging(false)
      onSelectionChange('minute')
      return
    }
    const { degrees, distance } = pointAt(e)
    select(timeAt(degrees, distance, true))
    if (isHour)
      switchTimer.current = setTimeout(() => onSelectionChange('minute'), 100)
  }
  const onPointerCancel = () => {
    press.current = null
    setDragging(false)
  }

  // The numbers in focus order: the outer ring, then the inner one.
  const values = isHour
    ? is24Hour
      ? [...HOURS.map((h) => h % 12), ...HOURS.map((h) => (h % 12) + 12)]
      : HOURS
    : MINUTES
  const current = isHour
    ? displayHour(time.hour, is24Hour)
    : (Math.round(time.minute / 5) * 5) % 60
  const timeFor = (v: number): Time =>
    isHour
      ? { ...time, hour: is24Hour ? v : (v % 12) + (isPm ? 12 : 0) }
      : { ...time, minute: v }

  const onKeyDown = (e: KeyboardEvent, v: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      e.key
    ]
    if (step) {
      e.preventDefault()
      const at = values.indexOf(current)
      select(timeFor(values[(at + step + values.length) % values.length]!))
      refocus.current = true
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Choosing from the keyboard stays on the hours, as in Compose.
      e.preventDefault()
      select(timeFor(v))
    }
  }

  const place = (i: number) => {
    const ring = i < 12 ? OUTER : INNER
    const a = ((i % 12) * Math.PI) / 6
    return {
      left: DIAL / 2 + ring * Math.sin(a) - 24,
      top: DIAL / 2 - ring * Math.cos(a) - 24
    }
  }
  const labels = (selected: boolean) =>
    values.map((v, i) => {
      const text = formatDigits(v, 1, locale)
      if (selected)
        return (
          <span key={v} className={styles.label} style={place(i)}>
            {text}
          </span>
        )
      return (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === current}
          aria-label={describe(v, selection, is24Hour, locale, strings)}
          tabIndex={v === current ? 0 : -1}
          className={cx(styles.label, focusRing)}
          style={place(i)}
          onKeyDown={(e) => onKeyDown(e, v)}
          // Only clicks without a pointer: the dial handles the rest.
          onClick={(e) => {
            if (e.detail !== 0) return
            select(timeFor(v))
            if (isHour) onSelectionChange('minute')
          }}
        >
          {text}
        </button>
      )
    })

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={isHour ? strings.selectHour : strings.selectMinutes}
      className={styles.dial}
      data-dragging={dragging || undefined}
      style={
        {
          '--_dial-angle': `${angle}deg`,
          '--_dial-reach': `${inner ? INNER : OUTER}px`
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className={styles.hand} aria-hidden />
      <div key={selection} className={styles.face}>
        <div className={styles.labels}>{labels(false)}</div>
        <div className={styles.selectedLabels} aria-hidden>
          {labels(true)}
        </div>
      </div>
    </div>
  )
}

export type TimeInputProps = Omit<TimePickerProps, 'layout'> & {
  /** Whether the fields hold a time; called as typing changes it. */
  onValidityChange?: (valid: boolean) => void
}

// The hour typed, read in the current period as Compose does: an empty
// field is midnight or noon, and 12 is the period's first hour.
function hourFrom(text: string, isPm: boolean, is24Hour: boolean) {
  if (!text) return isPm && !is24Hour ? 12 : 0
  const n = +text
  if (is24Hour) return n <= 23 ? n : null
  const hour = n === 12 ? (isPm ? 12 : 0) : n + (isPm ? 12 : 0)
  return hour >= (isPm ? 12 : 0) && hour <= (isPm ? 23 : 11) ? hour : null
}

const minuteFrom = (text: string) => (+text <= 59 ? +text : null)

/** An M3 time input: the hour and minutes typed into two fields. */
export function TimeInput({
  value,
  onValueChange,
  is24Hour,
  locale,
  strings: given,
  onValidityChange,
  className
}: TimeInputProps) {
  const strings = { ...timePickerStrings, ...given }
  const time = parseTime(value)
  const h24 = useMemo(() => is24Hour ?? uses24Hour(locale), [is24Hour, locale])
  const isPm = time.hour >= 12
  const [selection, setSelection] = useState<Selection>('hour')
  // What's typed, while it differs from the time shown.
  const [hourText, setHourText] = useState<string | null>(null)
  const [minuteText, setMinuteText] = useState<string | null>(null)
  const hourOk = hourText === null || hourFrom(hourText, isPm, h24) !== null
  const minuteOk = minuteText === null || minuteFrom(minuteText) !== null
  const minuteRef = useRef<HTMLInputElement>(null)
  const id = useId()

  const typeHour = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value.replace(/\D/g, '').slice(0, 2)
    const hour = hourFrom(text, isPm, h24)
    setHourText(text)
    onValidityChange?.(hour !== null && minuteOk)
    if (hour === null) return
    onValueChange(toValue({ ...time, hour }))
    // Two digits, or one that can't start a 12-hour hour, move on.
    const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith(
      'delete'
    )
    if (text.length === 2 || (!h24 && !deleting && +text >= 2))
      minuteRef.current?.focus()
  }
  const typeMinute = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value.replace(/\D/g, '').slice(0, 2)
    const minute = minuteFrom(text)
    setMinuteText(text)
    onValidityChange?.(hourOk && minute !== null)
    if (minute !== null) onValueChange(toValue({ ...time, minute }))
  }
  // A digit after a full, valid hour goes on to the minutes.
  const onHourKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    if (
      /^\d$/.test(e.key) &&
      hourOk &&
      input.value.length === 2 &&
      input.selectionStart === 2 &&
      input.selectionEnd === 2
    )
      minuteRef.current?.focus()
  }

  const field = (part: Selection) => {
    const isHour = part === 'hour'
    const ok = isHour ? hourOk : minuteOk
    const text = isHour ? hourText : minuteText
    const shown = isHour ? displayHour(time.hour, h24) : time.minute
    const error = isHour
      ? h24
        ? strings.hour24Error
        : strings.hourError
      : strings.minuteError
    return (
      <div className={styles.field}>
        <input
          ref={isHour ? undefined : minuteRef}
          className={styles.timeField}
          data-selected={selection === part || undefined}
          inputMode="numeric"
          autoComplete="off"
          aria-label={isHour ? strings.hour : strings.minute}
          aria-invalid={!ok || undefined}
          aria-describedby={ok ? undefined : `${id}-${part}`}
          value={text ?? pad(shown)}
          onChange={isHour ? typeHour : typeMinute}
          onKeyDown={isHour ? onHourKeyDown : undefined}
          onFocus={(e) => {
            setSelection(part)
            e.currentTarget.select()
          }}
          onBlur={() => {
            if (ok) (isHour ? setHourText : setMinuteText)(null)
          }}
        />
        <p
          id={`${id}-${part}`}
          className={cx(styles.supporting, !ok && styles.error)}
          aria-live="polite"
        >
          {ok ? (isHour ? strings.hour : strings.minute) : error}
        </p>
      </div>
    )
  }

  return (
    <div className={cx(styles.input, 'md-comp-time-input', className)}>
      {field('hour')}
      <Separator />
      {field('minute')}
      {!h24 && (
        <PeriodToggle
          time={time}
          onChange={(t) => {
            setHourText(null)
            onValueChange(toValue(t))
          }}
          disabled={!hourOk}
          locale={locale}
          strings={strings}
        />
      )}
    </div>
  )
}

export type TimePickerDialogProps = Omit<
  TimePickerProps,
  'value' | 'onValueChange' | 'layout'
> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The time it opens on, as "14:05". */
  value: string
  /** OK: the chosen time. */
  onConfirm: (value: string) => void
  /** The clock, or typing the time. */
  mode?: 'picker' | 'input'
  onModeChange?: (mode: 'picker' | 'input') => void
  showModeToggle?: boolean
  /**
   * The clock under the time or beside it; beside it by default when the
   * window is too short for the dialog, as on a landscape phone.
   */
  layout?: 'vertical' | 'horizontal'
  /** Extra content under the picker, before the buttons. */
  children?: ReactNode
}

/**
 * An M3 time picker in a modal dialog, with a switch to typing the time,
 * Cancel and OK. Cancel, Escape and the scrim leave the value as it was.
 */
export function TimePickerDialog({
  open,
  onOpenChange,
  strings: given,
  ...props
}: TimePickerDialogProps) {
  const strings = { ...timePickerStrings, ...given }
  const returnFocus = useReturnFocus()
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className={styles.scrim} />
        <Radix.Content
          className={cx(styles.dialog, 'md-comp-time-picker')}
          aria-describedby={undefined}
          {...returnFocus}
          // Open on the hour rather than the mode toggle and its tooltip.
          onOpenAutoFocus={(e) => {
            returnFocus.onOpenAutoFocus()
            e.preventDefault()
            const content = e.currentTarget as HTMLElement
            content
              .querySelector<HTMLElement>('input, [aria-checked="true"]')
              ?.focus()
          }}
        >
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
  mode: controlledMode,
  onModeChange,
  showModeToggle = true,
  layout,
  children,
  strings,
  ...props
}: Omit<TimePickerDialogProps, 'open' | 'onOpenChange' | 'strings'> & {
  strings: TimePickerStrings
  close: () => void
}) {
  const [draft, setDraft] = useState(value)
  const [valid, setValid] = useState(true)
  const [ownMode, setOwnMode] = useState<'picker' | 'input'>('picker')
  const mode = controlledMode ?? ownMode
  const [short] = useState(
    () =>
      window.matchMedia?.('(orientation: landscape) and (max-height: 560px)')
        .matches ?? false
  )
  const horizontal =
    mode === 'picker' &&
    (layout ?? (short ? 'horizontal' : 'vertical')) === 'horizontal'
  const toggle =
    mode === 'picker' ? strings.switchToInput : strings.switchToClock
  return (
    <div className={cx(styles.body, horizontal && styles.landscape)}>
      <Radix.Title className={styles.title}>
        {mode === 'picker' ? strings.title : strings.inputTitle}
      </Radix.Title>
      {mode === 'picker' ? (
        <TimePicker
          {...props}
          strings={strings}
          layout={horizontal ? 'horizontal' : 'vertical'}
          value={draft}
          onValueChange={setDraft}
        />
      ) : (
        <TimeInput
          {...props}
          strings={strings}
          value={draft}
          onValueChange={setDraft}
          onValidityChange={setValid}
        />
      )}
      {children}
      <div className={styles.actions}>
        {showModeToggle && (
          <Tooltip text={toggle}>
            <IconButton
              icon={mode === 'picker' ? 'keyboard' : 'schedule'}
              label={toggle}
              onClick={() => {
                const next = mode === 'picker' ? 'input' : 'picker'
                setOwnMode(next)
                setValid(true)
                onModeChange?.(next)
              }}
            />
          </Tooltip>
        )}
        <span className={styles.spacer} />
        <Button variant="text" onClick={close}>
          {strings.dismiss}
        </Button>
        <Button
          variant="text"
          disabled={mode === 'input' && !valid}
          onClick={() => {
            onConfirm(draft)
            close()
          }}
        >
          {strings.confirm}
        </Button>
      </div>
    </div>
  )
}
