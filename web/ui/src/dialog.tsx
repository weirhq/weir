import { Dialog as Radix } from 'radix-ui'
import type { ReactNode } from 'react'
import styles from './dialog.module.css'
import { Icon } from './icon'
import type { IconName } from './icon-names'
import { useReturnFocus } from './return-focus'
import './tokens/dialog.gen.css'
import './tokens/scrim.gen.css'

export type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** A sentence under the title, read out when the dialog opens. */
  description?: string
  /** An icon above the title, which centres the title under it. */
  icon?: IconName
  /** More content under the description, such as a text field. */
  children?: ReactNode
  /**
   * Buttons at the end, usually text buttons: dismiss first, confirm last.
   * A submit button for a form in children can name it with form="id".
   */
  actions?: ReactNode
}

/** An M3 basic dialog: modal, focus-trapped, closed with Escape. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  actions
}: DialogProps) {
  const returnFocus = useReturnFocus()
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className={`${styles.scrim} md-comp-scrim`} />
        <Radix.Content
          className={`${styles.dialog} md-comp-dialog`}
          {...returnFocus}
          // Without a description, say so rather than point at nothing.
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          {icon && (
            <span className={styles.icon}>
              <Icon name={icon} />
            </span>
          )}
          <Radix.Title className={styles.title}>{title}</Radix.Title>
          <div className={styles.body}>
            {description && (
              <Radix.Description className={styles.description}>
                {description}
              </Radix.Description>
            )}
            {children}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}
