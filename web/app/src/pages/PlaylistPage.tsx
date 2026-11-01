import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import {
  Button,
  Dialog,
  IconButton,
  List,
  ListItem,
  Switch,
  TextField
} from '@weirhq/m3e'
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
  const failed = update.error

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
              <Switch
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
            <Button variant="text" onClick={() => setConfirmDelete(true)}>
              Delete playlist
            </Button>
            <Dialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              title={`Delete “${pl.name}”?`}
              description="Its items stay on the server."
              actions={
                <>
                  <Button
                    variant="text"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    Delete
                  </Button>
                </>
              }
            >
              {remove.error && (
                <p role="alert" className={styles.dialogError}>
                  {errorMessage(remove.error)}
                </p>
              )}
            </Dialog>
          </>
        )}
      </div>
      {failed && (
        <p role="alert" className={styles.error}>
          {errorMessage(failed)}
        </p>
      )}
      <List ordered className={styles.list}>
        {items.map((item, i) => (
          <ListItem
            key={`${i}-${item.id}`}
            asChild
            leading={<span className={styles.number}>{i + 1}</span>}
            headline={item.title}
            supporting={kindNames[item.kind]}
            trailing={
              <>
                {item.kind === ItemKind.TRACK ? (
                  <IconButton
                    icon="play_arrow"
                    label={`Play ${item.title}`}
                    onClick={() => playFrom(item)}
                  />
                ) : (
                  <IconButton
                    asChild
                    icon="play_arrow"
                    label={`Play ${item.title}`}
                  >
                    <Link to="/play/$itemId" params={{ itemId: item.id }} />
                  </IconButton>
                )}
                {owned && (
                  <IconButton
                    icon="close"
                    label={`Remove ${item.title}`}
                    disabled={update.isPending}
                    onClick={() => without(i)}
                  />
                )}
              </>
            }
          >
            <Link to="/item/$itemId" params={{ itemId: item.id }} />
          </ListItem>
        ))}
      </List>
    </section>
  )
}
