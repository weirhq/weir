import {
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes
} from 'react'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import styles from './text-field.module.css'
import './tokens/filled-text-field.gen.css'
import './tokens/outlined-text-field.gen.css'

export type FieldCommonProps = {
  label?: string
  variant?: 'filled' | 'outlined'
  /** Help shown under the field. */
  supportingText?: ReactNode
  /** Shown under the field in place of the supporting text, and marks it
   * invalid. */
  error?: string
  /** A Material Symbol's name, or any element. */
  leadingIcon?: IconName | ReactElement
  /** A Material Symbol's name, or any element, such as an icon button. */
  trailingIcon?: IconName | ReactElement
  /** Text before the value, such as a currency sign. */
  prefix?: string
  /** Text after the value, such as a unit. */
  suffix?: string
}

export type TextFieldProps = FieldCommonProps &
  (
    | ({ multiline?: false } & InputHTMLAttributes<HTMLInputElement>)
    | ({ multiline: true } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  )

const iconOf = (i: IconName | ReactElement) =>
  typeof i === 'string' ? <Icon name={i} /> : i

/** What a field's control takes from the frame around it. */
export type FieldControlProps = {
  id: string
  ref: RefObject<
    (HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement) | null
  >
  className: string
  placeholder: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
}

/**
 * The parts of a text field around its control: label, icons, outline or
 * indicator, and supporting text. TextField and Select draw their own
 * control inside it.
 * @internal
 */
export function FieldFrame({
  label,
  variant = 'outlined',
  supportingText,
  error,
  leadingIcon,
  trailingIcon,
  prefix,
  suffix,
  multiline,
  id,
  className,
  placeholder,
  onBoxPress,
  boxControl = false,
  control
}: FieldCommonProps & {
  multiline?: boolean
  id?: string
  className?: string
  placeholder?: string
  /** Presses on the box outside the control; focuses it by default. */
  onBoxPress?: () => void
  /** The control covers the whole box, as a select's trigger does. */
  boxControl?: boolean
  control: (props: FieldControlProps) => ReactNode
}) {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  const helpId = `${inputId}-help`
  const help = error ?? supportingText
  const ref = useRef<
    HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement
  >(null)
  return (
    <div
      className={[
        styles.field,
        styles[variant],
        label && styles.hasLabel,
        leadingIcon && styles.hasLeading,
        trailingIcon && styles.hasTrailing,
        multiline && styles.multiline,
        boxControl && styles.boxControl,
        error && styles.error,
        `md-comp-${variant}-text-field`,
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={styles.container}
        // Presses on the box, outside the control itself, focus it.
        onMouseDown={(e) => {
          if (
            e.target !== ref.current &&
            !(e.target as Element).closest('button')
          ) {
            e.preventDefault()
            ref.current?.focus()
            onBoxPress?.()
          }
        }}
      >
        {leadingIcon && (
          <span className={styles.leading}>{iconOf(leadingIcon)}</span>
        )}
        <div className={styles.body}>
          {label && (
            <label className={styles.label} htmlFor={inputId}>
              {label}
            </label>
          )}
          <div className={styles.row}>
            {prefix && <span className={styles.prefix}>{prefix}</span>}
            {control({
              id: inputId,
              ref,
              className: styles.input!,
              // :placeholder-shown tells an empty field, so there must be one.
              placeholder: placeholder ?? ' ',
              'aria-invalid': error ? true : undefined,
              'aria-describedby': help ? helpId : undefined
            })}
            {suffix && <span className={styles.suffix}>{suffix}</span>}
          </div>
        </div>
        {trailingIcon && (
          <span className={styles.trailing}>{iconOf(trailingIcon)}</span>
        )}
        {variant === 'filled' ? (
          <span className={styles.indicator} aria-hidden />
        ) : (
          <fieldset className={styles.outline} aria-hidden>
            {label && (
              <legend className={styles.legend}>
                <span>{label}</span>
              </legend>
            )}
          </fieldset>
        )}
      </div>
      {help && (
        <div
          id={helpId}
          className={styles.supporting}
          role={error ? 'alert' : undefined}
        >
          {help}
        </div>
      )}
    </div>
  )
}

/**
 * An M3 text field, filled or outlined (the default), with a label that
 * floats when the field is focused or has text. Set multiline for a
 * textarea.
 */
export function TextField(props: TextFieldProps) {
  const {
    label,
    variant,
    supportingText,
    error,
    leadingIcon,
    trailingIcon,
    prefix,
    suffix,
    multiline,
    id,
    className,
    placeholder,
    ...rest
  } = props
  return (
    <FieldFrame
      {...{ label, variant, supportingText, error, leadingIcon, trailingIcon }}
      {...{ prefix, suffix, multiline, id, className, placeholder }}
      control={(shared) =>
        multiline ? (
          <textarea
            {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
            {...shared}
          />
        ) : (
          <input
            {...(rest as InputHTMLAttributes<HTMLInputElement>)}
            {...shared}
          />
        )
      }
    />
  )
}
