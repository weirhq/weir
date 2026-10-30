import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Button, TextField } from '@weirhq/ui'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../errors'
import { appendToPlaylist, playlistsKey } from '../pages/playlists'
import styles from './AddToPlaylist.module.css'

/** Adds a film, episode or track to one of the caller's playlists, or a new one. */
export function AddToPlaylist({ itemId }: { itemId: string }) {
  const { api, session } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [added, setAdded] = useState('')
  const playlists = useQuery({
    queryKey: playlistsKey,
    enabled: open,
    queryFn: async () => (await api.playlists.listPlaylists({})).playlists
  })
  const own = (playlists.data ?? []).filter(
    (p) => p.ownerId === session.user?.id
  )
  const done = (playlist: string) => {
    setAdded(playlist)
    setOpen(false)
    setName('')
    void queryClient.invalidateQueries({ queryKey: playlistsKey })
    void queryClient.invalidateQueries({ queryKey: ['playlist'] })
  }
  const add = useMutation({
    mutationFn: async (p: { id: string; name: string }) => {
      await appendToPlaylist(api, p.id, itemId)
      return p.name
    },
    onSuccess: done
  })
  const create = useMutation({
    mutationFn: async () =>
      (
        await api.playlists.createPlaylist({
          name: name.trim(),
          itemIds: [itemId]
        })
      ).playlist!.name,
    onSuccess: done
  })
  const failed = add.error ?? create.error

  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }

  return (
    <div className={styles.wrap}>
      <Button
        variant="tonal"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setAdded('')
        }}
      >
        Add to playlist
      </Button>
      {added && (
        <p role="status" className={styles.status}>
          Added to {added}
        </p>
      )}
      {open && (
        <div className={styles.panel} role="group" aria-label="Add to playlist">
          {own.length > 0 && (
            <ul className={styles.list}>
              {own.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={styles.choice}
                    disabled={add.isPending}
                    onClick={() => add.mutate(p)}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className={styles.create} onSubmit={submit}>
            <TextField
              label="New playlist"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Create
            </Button>
          </form>
          {failed && (
            <p role="alert" className={styles.error}>
              {errorMessage(failed)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
