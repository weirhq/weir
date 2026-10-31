import { Slot } from 'radix-ui'
import type {
  HTMLAttributes,
  MouseEventHandler,
  ReactElement,
  ReactNode
} from 'react'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import styles from './list.module.css'
import { StateLayer } from './state-layer'
import './tokens/list.gen.css'
import './tokens/divider.gen.css'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export type ListProps = HTMLAttributes<HTMLUListElement> & {
  /** Numbered, as an ol. */
  ordered?: boolean
  /** Items as separate rounded segments, 2dp apart. */
  segmented?: boolean
}

/** An M3 list: put ListItems in it. */
export function List({
  ordered = false,
  segmented = false,
  className,
  ...props
}: ListProps) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      className={cx(
        styles.list,
        segmented && styles.segmented,
        'md-comp-list',
        'md-comp-divider',
        className
      )}
      {...(props as HTMLAttributes<HTMLElement>)}
    />
  )
}

export type ListItemProps = {
  headline: ReactNode
  /** A short line above the headline. */
  overline?: ReactNode
  supporting?: ReactNode
  /** Make room for supporting text that wraps onto a second line. */
  threeLine?: boolean
  /** A Material Symbol's name, or any element, such as an avatar or a
   * number. */
  leading?: IconName | ReactElement
  /** Short text at the end, such as a duration. */
  trailingText?: ReactNode
  /** Content at the end outside the item's own action, such as buttons. */
  trailing?: ReactNode
  /** Makes the item a button. */
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** The item's action is the child element, such as a link, which gets
   * the item's content. */
  asChild?: boolean
  children?: ReactElement
  selected?: boolean
  disabled?: boolean
  'aria-current'?: HTMLAttributes<HTMLElement>['aria-current']
  className?: string
}

/**
 * An item in a List. Give it onClick, or asChild with a link, to make it
 * pressable, which brings M3 Expressive's shapes and selected colours.
 */
export function ListItem({
  headline,
  overline,
  supporting,
  threeLine = false,
  leading,
  trailingText,
  trailing,
  onClick,
  asChild = false,
  children,
  selected = false,
  disabled,
  'aria-current': current,
  className
}: ListItemProps) {
  const interactive = asChild || onClick !== undefined
  const lines =
    threeLine || (overline && supporting) ? 3 : overline || supporting ? 2 : 1
  // The spaces between parts keep their text apart when it's read out;
  // flex layout ignores them.
  const content = (
    <>
      {leading !== undefined && (
        <span className={styles.leading}>
          {typeof leading === 'string' ? <Icon name={leading} /> : leading}
        </span>
      )}{' '}
      <span className={styles.text}>
        {overline && <span className={styles.overline}>{overline}</span>}{' '}
        <span className={styles.headline}>{headline}</span>{' '}
        {supporting && <span className={styles.supporting}>{supporting}</span>}
      </span>{' '}
      {trailingText && (
        <span className={styles.trailingText}>{trailingText}</span>
      )}
    </>
  )
  return (
    <li
      aria-current={current}
      className={cx(
        styles.item,
        lines === 2 && styles.twoLine,
        lines === 3 && styles.threeLine,
        interactive && styles.interactive,
        selected && styles.selected,
        className
      )}
    >
      {asChild ? (
        <Slot.Root className={styles.action}>
          {content}
          <Slot.Slottable>{children}</Slot.Slottable>
        </Slot.Root>
      ) : onClick ? (
        <button
          type="button"
          className={styles.action}
          disabled={disabled}
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        content
      )}
      {trailing && <span className={styles.trailing}>{trailing}</span>}
      {interactive && <StateLayer />}
    </li>
  )
}

/** A line between items in a List, inset as M3 lists inset it. */
export function ListDivider() {
  return <li role="separator" className={styles.divider} />
}
