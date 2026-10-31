import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { Button, List, ListItem, TextField } from '@weirhq/m3e'
import { useState, type FormEvent } from 'react'
import cards from '../components/Cards.module.css'
import { errorMessage } from '../errors'
import { playlistsKey } from './playlists'
import styles from './Playlists.module.css'

/** The caller's playlists and everyone's shared ones. */
export function PlaylistsPage() {
  const { api, session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const playlists = useQuery({
    queryKey: playlistsKey,
    queryFn: async () => (await api.playlists.listPlaylists({})).playlists
  })
  const create = useMutation({
    mutationFn: async () =>
      (await api.playlists.createPlaylist({ name: name.trim() })).playlist!,
    onSuccess: (p) =>
      navigate({ to: '/playlist/$playlistId', params: { playlistId: p.id } })
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }

  return (
    <section className={cards.section}>
      <h1 className={cards.heading}>Playlists</h1>
      <form className={styles.create} onSubmit={submit}>
        <TextField
          label="New playlist"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={create.error ? errorMessage(create.error) : undefined}
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          Create
        </Button>
      </form>
      {playlists.data?.length === 0 && (
        <p className={styles.note}>
          No playlists yet. Add films, episodes or tracks from their pages.
        </p>
      )}
      <List className={styles.list}>
        {playlists.data?.map((p) => (
          <ListItem
            key={p.id}
            asChild
            headline={p.name}
            supporting={
              count(p.itemCount) +
              (p.ownerId !== session.user?.id
                ? ` · shared by ${p.ownerName}`
                : p.shared
                  ? ' · shared'
                  : '')
            }
          >
            <Link to="/playlist/$playlistId" params={{ playlistId: p.id }} />
          </ListItem>
        ))}
      </List>
    </section>
  )
}

export function count(n: number): string {
  return `${n} item${n === 1 ? '' : 's'}`
}
