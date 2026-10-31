import type {
  ButtonHTMLAttributes,
  MouseEventHandler,
  ReactElement,
  ReactNode
} from 'react'
import styles from './chip.module.css'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import { focusRing, StateLayer } from './state-layer'
import './tokens/chips.gen.css'
import './tokens/assist-chip.gen.css'
import './tokens/suggestion-chip.gen.css'
import './tokens/filter-chip.gen.css'
import './tokens/input-chip.gen.css'

type IconProp = IconName | ReactElement

const icon = (i: IconProp | undefined, className: string) =>
  i === undefined ? null : typeof i === 'string' ? (
    <Icon name={i} className={className} />
  ) : (
    <span className={className}>{i}</span>
  )

const cx = (...classes: (string | false | undefined)[]) =>
  classes.filter(Boolean).join(' ')

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** The label. */
  children: ReactNode
  /** A leading icon: a Material Symbol's name, or any element. */
  icon?: IconProp
  /** Raised with a shadow instead of outlined. */
  elevated?: boolean
}

function ActionChip({
  kind,
  children,
  icon: leading,
  elevated = false,
  className,
  ...props
}: ChipProps & { kind: 'assist' | 'suggestion' }) {
  return (
    <button
      className={cx(
        styles.chip,
        styles[kind],
        elevated && styles.elevated,
        leading !== undefined && styles.hasLeading,
        focusRing,
        `md-comp-${kind}-chip`,
        className
      )}
      {...props}
    >
      <StateLayer />
      {icon(leading, styles.leading!)}
      {children}
    </button>
  )
}

/** An M3 assist chip: a smart or automated action related to the content. */
export function AssistChip(props: ChipProps) {
  return <ActionChip {...props} kind="assist" />
}

/** An M3 suggestion chip: a suggested reply or search. */
export function SuggestionChip(props: ChipProps) {
  return <ActionChip {...props} kind="suggestion" />
}

export type FilterChipProps = ChipProps & {
  selected: boolean
  /** A trailing icon, such as a menu's arrow. */
  trailingIcon?: IconProp
  /** M3 Expressive's shapes: medium corners, small pressed, round selected. */
  morph?: boolean
}

/**
 * An M3 filter chip: one of a set of filters, toggled on or off. When on,
 * a check takes the place of its icon, as in Compose's samples.
 */
export function FilterChip({
  children,
  selected,
  icon: leading,
  trailingIcon,
  elevated = false,
  morph = false,
  className,
  ...props
}: FilterChipProps) {
  const shown = selected ? 'check' : leading
  return (
    <button
      aria-pressed={selected}
      className={cx(
        styles.chip,
        styles.filter,
        elevated && styles.elevated,
        morph && styles.morph,
        shown !== undefined && styles.hasLeading,
        trailingIcon !== undefined && styles.hasTrailing,
        focusRing,
        'md-comp-filter-chip',
        morph && 'md-comp-chips',
        className
      )}
      {...props}
    >
      <StateLayer />
      {icon(shown, styles.leading!)}
      {children}
      {icon(trailingIcon, styles.trailing!)}
    </button>
  )
}

export type InputChipProps = {
  /** The label: something the person entered or chose. */
  children: ReactNode
  /** A leading icon, or */
  icon?: IconProp
  /** an image of the person or thing, shown round. */
  avatar?: ReactElement
  /** Makes the chip selectable, selected or not. */
  selected?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** Shows a remove button that calls this. */
  onRemove?: MouseEventHandler<HTMLButtonElement>
  /** Names the remove button; "Remove" and the label by default. */
  removeLabel?: string
  disabled?: boolean
  /** M3 Expressive's shapes: medium corners, small pressed, round selected. */
  morph?: boolean
  className?: string
}

/**
 * An M3 input chip: a piece of information the person entered, like a
 * name in a recipient list, which they can usually remove.
 */
export function InputChip({
  children,
  icon: leading,
  avatar,
  selected,
  onClick,
  onRemove,
  removeLabel,
  disabled,
  morph = false,
  className
}: InputChipProps) {
  return (
    <span
      className={cx(
        styles.chip,
        styles.input,
        selected && styles.selected,
        morph && styles.morph,
        avatar ? styles.hasAvatar : leading !== undefined && styles.hasLeading,
        onRemove && styles.hasTrailing,
        'md-comp-input-chip',
        morph && 'md-comp-chips',
        className
      )}
    >
      <button
        type="button"
        className={cx(styles.part, styles.main)}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
      >
        {avatar ? (
          <span className={cx(styles.leading, styles.avatar)}>{avatar}</span>
        ) : (
          icon(leading, styles.leading!)
        )}
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          className={cx(styles.part, styles.remove, styles.trailing)}
          aria-label={
            removeLabel ??
            (typeof children === 'string' ? `Remove ${children}` : 'Remove')
          }
          disabled={disabled}
          onClick={onRemove}
        >
          <Icon name="close" />
        </button>
      )}
      <StateLayer />
    </span>
  )
}
