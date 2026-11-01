import { Popover, Tooltip as Radix } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'
import styles from './tooltip.module.css'
import './tokens/plain-tooltip.gen.css'
import './tokens/rich-tooltip.gen.css'

type Side = 'top' | 'right' | 'bottom' | 'left'

export type TooltipProps = {
  /** A few words about the child, such as an icon button's label. */
  text: string
  /** Above by default, moving if there's no room. */
  side?: Side
  /** The element it describes, which must take a ref. */
  children: ReactElement
}

/**
 * An M3 plain tooltip: shown straight away while the child is hovered or
 * keyboard-focused, as Compose's TooltipBox shows it.
 */
export function Tooltip({ text, side = 'top', children }: TooltipProps) {
  return (
    <Radix.Provider delayDuration={0}>
      <Radix.Root>
        <Radix.Trigger asChild>{children}</Radix.Trigger>
        <Radix.Portal>
          <Radix.Content
            side={side}
            sideOffset={4}
            collisionPadding={8}
            className={`${styles.plain} md-comp-plain-tooltip`}
          >
            {text}
          </Radix.Content>
        </Radix.Portal>
      </Radix.Root>
    </Radix.Provider>
  )
}

export type RichTooltipProps = {
  title?: string
  text: ReactNode
  /**
   * A text button. With one, the tooltip opens when the child is pressed
   * and stays until it's dismissed or the action is pressed, so the action
   * can be reached.
   */
  action?: ReactElement
  side?: Side
  children: ReactElement
}

/** An M3 rich tooltip: a title, a few lines of text and an action. */
export function RichTooltip({
  title,
  text,
  action,
  side = 'top',
  children
}: RichTooltipProps) {
  const className = `${styles.rich} md-comp-rich-tooltip`
  const body = (
    <>
      {title && <p className={styles.title}>{title}</p>}
      <p className={styles.text}>{text}</p>
    </>
  )
  if (!action)
    return (
      <Radix.Provider delayDuration={0}>
        <Radix.Root>
          <Radix.Trigger asChild>{children}</Radix.Trigger>
          <Radix.Portal>
            <Radix.Content
              side={side}
              sideOffset={4}
              collisionPadding={8}
              className={className}
            >
              {body}
            </Radix.Content>
          </Radix.Portal>
        </Radix.Root>
      </Radix.Provider>
    )
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          sideOffset={4}
          collisionPadding={8}
          className={className}
          aria-label={title}
        >
          {body}
          <div className={styles.action}>
            {/* Pressing the action also closes the tooltip. */}
            <Popover.Close asChild>{action}</Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
