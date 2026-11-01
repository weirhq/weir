import { useSyncExternalStore } from 'react'

/** Whether the window matches a media query, following it as it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', changed)
      return () => list.removeEventListener('change', changed)
    },
    () => window.matchMedia(query).matches
  )
}
