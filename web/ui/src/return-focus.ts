import { useRef } from 'react'

/**
 * Props for a Radix dialog's Content that put focus back where it was when
 * the dialog opened. Radix only returns it to its own Trigger, and these
 * dialogs are opened by whatever the app likes.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement as HTMLElement | null
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault()
      opener.current?.focus()
    }
  }
}
