import type { Api } from '../api'

export const playlistsKey = ['playlists'] as const
export const playlistKey = (id: string) => ['playlist', id] as const

/**
 * Appends an item to a playlist. The API replaces the whole list, so this
 * reads it first; a concurrent edit by the same owner can be lost.
 */
export async function appendToPlaylist(api: Api, id: string, itemId: string) {
  const { items } = await api.playlists.getPlaylist({ id })
  await api.playlists.updatePlaylist({
    id,
    itemIds: [...items.map((i) => i.id), itemId],
    updateMask: { paths: ['item_ids'] }
  })
}
