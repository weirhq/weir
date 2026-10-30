import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Button, Dialog, TextField } from '@weirhq/ui'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from '../../errors'
import { Role, type User } from '../../gen/weir/api/v1alpha/user_pb'
import { accessKey, adminLibrariesKey, usersKey } from './keys'
import styles from './Admin.module.css'

const roleNames: Record<Role, string> = {
  [Role.UNSPECIFIED]: '',
  [Role.ADMIN]: 'Admin',
  [Role.MEMBER]: 'Member'
}

export function UsersPage() {
  const { api, session } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string>()
  const [deleting, setDeleting] = useState<User>()
  const users = useQuery({
    queryKey: usersKey,
    queryFn: async () => (await api.admin.listUsers({})).users
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.admin.deleteUser({ id }),
    onSuccess: () => {
      setDeleting(undefined)
      void queryClient.invalidateQueries({ queryKey: usersKey })
    }
  })

  return (
    <section aria-label="Users">
      {users.error && (
        <p role="alert" className={styles.error}>
          {errorMessage(users.error)}
        </p>
      )}
      <ul className={styles.list}>
        {users.data?.map((u) => (
          <li key={u.id} className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{u.displayName}</h2>
              <span className={styles.meta}>
                {u.username} · {roleNames[u.role]}
                {u.id === session.user?.id && ' · you'}
              </span>
            </div>
            {editing === u.id ? (
              <EditUser user={u} onDone={() => setEditing(undefined)} />
            ) : (
              <div className={styles.actions}>
                <Button variant="tonal" onClick={() => setEditing(u.id)}>
                  Edit
                </Button>
                {u.id !== session.user?.id && (
                  <Button variant="text" onClick={() => setDeleting(u)}>
                    Delete
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className={styles.card}>
          <NewUser onDone={() => setAdding(false)} />
        </div>
      ) : (
        <Button onClick={() => setAdding(true)}>Add user</Button>
      )}
      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={`Delete ${deleting?.displayName}?`}
        description="They’re signed out everywhere, and their playlists and watch history go with them."
      >
        {remove.error && (
          <p role="alert" className={styles.error}>
            {errorMessage(remove.error)}
          </p>
        )}
        <div className={styles.dialogActions}>
          <Button variant="text" onClick={() => setDeleting(undefined)}>
            Cancel
          </Button>
          <Button
            disabled={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting.id)}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </section>
  )
}

function RoleSelect({
  value,
  onChange
}: {
  value: Role
  onChange: (r: Role) => void
}) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        Role
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as Role)}
      >
        <option value={Role.MEMBER}>Member</option>
        <option value={Role.ADMIN}>Admin</option>
      </select>
    </div>
  )
}

function NewUser({ onDone }: { onDone: () => void }) {
  const { api } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(Role.MEMBER)
  const create = useMutation({
    mutationFn: () =>
      api.admin.createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey })
      onDone()
    }
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <TextField
        label="Username"
        autoComplete="off"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <TextField
        label="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <RoleSelect value={role} onChange={setRole} />
      {create.error && (
        <p role="alert" className={styles.error}>
          {errorMessage(create.error)}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          type="submit"
          disabled={!username.trim() || !password || create.isPending}
        >
          Add user
        </Button>
        <Button variant="text" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function EditUser({ user, onDone }: { user: User; onDone: () => void }) {
  const { api } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [role, setRole] = useState(user.role)
  const [password, setPassword] = useState('')
  const update = useMutation({
    mutationFn: async () => {
      // Only what changed; a password signs them out everywhere.
      const paths = [
        displayName.trim() !== user.displayName && 'display_name',
        role !== user.role && 'role',
        password && 'password'
      ].filter((p): p is string => Boolean(p))
      if (!paths.length) return
      await api.admin.updateUser({
        id: user.id,
        displayName: displayName.trim(),
        role,
        password,
        updateMask: { paths }
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey })
      onDone()
    }
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    update.mutate()
  }

  return (
    <>
      <form className={styles.form} onSubmit={submit}>
        <TextField
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <RoleSelect value={role} onChange={setRole} />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="Unchanged"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {password && (
          <p className={styles.meta}>
            Setting a password signs them out on every device.
          </p>
        )}
        {update.error && (
          <p role="alert" className={styles.error}>
            {errorMessage(update.error)}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
          <Button variant="text" type="button" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
      {user.role === Role.ADMIN ? (
        <p className={styles.meta}>
          Admins can see, play and manage every library.
        </p>
      ) : (
        <AccessEditor userId={user.id} />
      )}
    </>
  )
}

type Flag = 'view' | 'play' | 'manage'
const flagNames: Record<Flag, string> = {
  view: 'Browse',
  play: 'Play',
  manage: 'Manage'
}

/** What a member may do in each library. Play and manage need browse. */
function AccessEditor({ userId }: { userId: string }) {
  const { api } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, Record<Flag, boolean>>>()
  const [saved, setSaved] = useState(false)
  const libraries = useQuery({
    queryKey: adminLibrariesKey,
    queryFn: async () => (await api.admin.listLibraries({})).libraries
  })
  const access = useQuery({
    queryKey: accessKey(userId),
    queryFn: async () => (await api.admin.getLibraryAccess({ userId })).access
  })
  const save = useMutation({
    mutationFn: (
      rows: {
        libraryId: string
        view: boolean
        play: boolean
        manage: boolean
      }[]
    ) => api.admin.setLibraryAccess({ userId, access: rows }),
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: accessKey(userId) })
    }
  })
  if (!libraries.data || !access.data) return null

  const current = (libraryId: string): Record<Flag, boolean> => {
    if (draft?.[libraryId]) return draft[libraryId]
    const a = access.data.find((x) => x.libraryId === libraryId)
    return { view: !!a?.view, play: !!a?.play, manage: !!a?.manage }
  }
  const toggle = (libraryId: string, flag: Flag, on: boolean) => {
    const next = { ...current(libraryId), [flag]: on }
    if (flag === 'view' && !on) next.play = next.manage = false
    if (flag !== 'view' && on) next.view = true
    setDraft({ ...draft, [libraryId]: next })
    setSaved(false)
  }
  const rows = libraries.data
    .map((l) => ({ libraryId: l.id, ...current(l.id) }))
    .filter((r) => r.view)

  return (
    <fieldset className={styles.access}>
      <legend className={styles.label}>Library access</legend>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Library</th>
            {(Object.keys(flagNames) as Flag[]).map((f) => (
              <th key={f} scope="col">
                {flagNames[f]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {libraries.data.map((l) => (
            <tr key={l.id}>
              <th scope="row">{l.name}</th>
              {(Object.keys(flagNames) as Flag[]).map((f) => (
                <td key={f}>
                  <input
                    type="checkbox"
                    aria-label={`${flagNames[f]} ${l.name}`}
                    checked={current(l.id)[f]}
                    onChange={(e) => toggle(l.id, f, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {save.error && (
        <p role="alert" className={styles.error}>
          {errorMessage(save.error)}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          variant="tonal"
          disabled={!draft || save.isPending}
          onClick={() => save.mutate(rows)}
        >
          Save access
        </Button>
        {saved && <span role="status">Access saved</span>}
      </div>
    </fieldset>
  )
}
