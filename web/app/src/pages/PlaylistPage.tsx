import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { Button, TextField } from '@weirhq/m3e'
import { useState, type FormEvent } from 'react'
import cards from '../components/Cards.module.css'
import { errorMessage } from '../errors'
import { ItemKind, type ItemSummary } from '../gen/weir/api/v1alpha/browse_pb'
import { useQueue } from '../player/queue'
import { playlistRoute } from '../router'
import { playlistKey, playlistsKey } from './playlists'
import { count } from './PlaylistsPage'
import styles from './Playlists.module.css'

const kindNames: Partial<Record<ItemKind, string>> = {
  [ItemKind.MOVIE]: 'Film',
  [ItemKind.EPISODE]: 'Episode',
  [ItemKind.TRACK]: 'Track'
}

// One change to the playlist; the mask names the fields it sets.
type Change = {
  name?: string
  itemIds?: string[]
  shared?: boolean
  updateMask: { paths: string[] }
}

export function PlaylistPage() {
  const { playlistId } = playlistRoute.useParams()
  const { api, session } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const startQueue = useQueue((q) => q.start)
  const [renaming, setRenaming] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const playlist = useQuery({
    queryKey: playlistKey(playlistId),
    queryFn: () => api.playlists.getPlaylist({ id: playlistId })
  })
  const update = useMutation({
    mutationFn: (req: Change) =>
      api.playlists.updatePlaylist({ ...req, id: playlistId }),
    onSuccess: () => {
      setRenaming(undefined)
      void queryClient.invalidateQueries({ queryKey: playlistKey(playlistId) })
      void queryClient.invalidateQueries({ queryKey: playlistsKey })
    }
  })
  const remove = useMutation({
    mutationFn: () => api.playlists.deletePlaylist({ id: playlistId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: playlistsKey })
      await navigate({ to: '/playlists' })
    }
  })

  if (playlist.isError)
    return (
      <p className={cards.empty}>
        This playlist doesn’t exist, or isn’t shared with you.
      </p>
    )
  const pl = playlist.data?.playlist
  if (!pl) return null
  const items = playlist.data!.items
  const owned = pl.ownerId === session.user?.id
  const tracks = items.filter((i) => i.kind === ItemKind.TRACK)
  const failed = update.error ?? remove.error

  function rename(e: FormEvent) {
    e.preventDefault()
    if (renaming?.trim())
      update.mutate({ name: renaming.trim(), updateMask: { paths: ['name'] } })
  }

  // The list as the caller sees it, without the one at index.
  const without = (index: number) =>
    update.mutate({
      itemIds: items.filter((_, i) => i !== index).map((i) => i.id),
      updateMask: { paths: ['item_ids'] }
    })

  const playFrom = (item: ItemSummary) =>
    startQueue(tracks, Math.max(0, tracks.indexOf(item)))

  return (
    <section className={cards.section}>
      {renaming === undefined ? (
        <h1 className={cards.heading}>{pl.name}</h1>
      ) : (
        <form className={styles.create} onSubmit={rename}>
          <TextField
            label="Name"
            value={renaming}
            autoFocus
            onChange={(e) => setRenaming(e.target.value)}
          />
          <Button type="submit" disabled={!renaming.trim() || update.isPending}>
            Save
          </Button>
          <Button variant="text" onClick={() => setRenaming(undefined)}>
            Cancel
          </Button>
        </form>
      )}
      <p className={styles.note}>
        {count(items.length)}
        {owned ? '' : ` · shared by ${pl.ownerName}`}
      </p>
      <div className={styles.actions}>
        {tracks.length > 0 && (
          <Button onClick={() => startQueue(tracks)}>
            {tracks.length === items.length ? 'Play all' : 'Play all tracks'}
          </Button>
        )}
        {owned && (
          <>
            {renaming === undefined && (
              <Button variant="tonal" onClick={() => setRenaming(pl.name)}>
                Rename
              </Button>
            )}
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={pl.shared}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate({
                    shared: e.target.checked,
                    updateMask: { paths: ['shared'] }
                  })
                }
              />
              Shared with everyone
            </label>
            {confirmDelete ? (
              <span className={styles.confirm}>
                Delete “{pl.name}”?
                <Button
                  variant="tonal"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Delete
                </Button>
                <Button variant="text" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button variant="text" onClick={() => setConfirmDelete(true)}>
                Delete playlist
              </Button>
            )}
          </>
        )}
      </div>
      {failed && (
        <p role="alert" className={styles.error}>
          {errorMessage(failed)}
        </p>
      )}
      <ol className={styles.list}>
        {items.map((item, i) => (
          <li key={`${i}-${item.id}`} className={styles.item}>
            <span className={styles.number}>{i + 1}</span>
            <Link
              to="/item/$itemId"
              params={{ itemId: item.id }}
              className={styles.name}
            >
              {item.title}
            </Link>
            <span className={styles.meta}>{kindNames[item.kind]}</span>
            {item.kind === ItemKind.TRACK ? (
              <Button
                variant="text"
                aria-label={`Play ${item.title}`}
                onClick={() => playFrom(item)}
              >
                ▶
              </Button>
            ) : (
              <Button variant="text" asChild>
                <Link
                  to="/play/$itemId"
                  params={{ itemId: item.id }}
                  aria-label={`Play ${item.title}`}
                >
                  ▶
                </Link>
              </Button>
            )}
            {owned && (
              <Button
                variant="text"
                aria-label={`Remove ${item.title}`}
                disabled={update.isPending}
                onClick={() => without(i)}
              >
                ✕
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
