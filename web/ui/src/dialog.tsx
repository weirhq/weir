import { Dialog as Radix } from 'radix-ui'
import type { ReactNode } from 'react'
import styles from './dialog.module.css'

export type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** A sentence under the title, read out when the dialog opens. */
  description?: string
  children?: ReactNode
}

/** An M3 basic dialog: modal, focus-trapped, closed with Escape. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children
}: DialogProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className={styles.scrim} />
        <Radix.Content
          className={styles.dialog}
          // Without a description, say so rather than point at nothing.
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <Radix.Title className={styles.title}>{title}</Radix.Title>
          {description && (
            <Radix.Description className={styles.description}>
              {description}
            </Radix.Description>
          )}
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}
