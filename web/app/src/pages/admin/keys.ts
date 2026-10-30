import type { Timestamp } from '@bufbuild/protobuf/wkt'
import { LibraryKind } from '../../gen/weir/api/v1alpha/library_pb'

export const adminLibrariesKey = ['admin', 'libraries'] as const
export const usersKey = ['admin', 'users'] as const
export const statusKey = ['admin', 'status'] as const
export const accessKey = (userId: string) =>
  ['admin', 'access', userId] as const

export const kindNames: Record<LibraryKind, string> = {
  [LibraryKind.UNSPECIFIED]: '',
  [LibraryKind.MOVIES]: 'Films',
  [LibraryKind.SHOWS]: 'TV shows',
  [LibraryKind.MUSIC]: 'Music'
}

/** "30 Oct 2026, 15:04" in the viewer's locale. */
export function when(t: Timestamp | undefined): string {
  if (!t) return ''
  return new Date(Number(t.seconds) * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}
