import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Button, Dialog, TextField } from '@weirhq/m3e'
import { useId, useState, type FormEvent } from 'react'
import { librariesKey } from '../../components/AppShell'
import { errorMessage } from '../../errors'
import { JobState, type Job } from '../../gen/weir/api/v1alpha/admin_pb'
import {
  LibraryKind,
  type Library
} from '../../gen/weir/api/v1alpha/library_pb'
import {
  adminLibrariesKey,
  adminLibrariesQuery,
  kindNames,
  statusKey,
  when
} from './keys'
import styles from './Admin.module.css'

type Draft = { name: string; kind: LibraryKind; paths: string[] }

export function LibrariesPage() {
  const { api } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string>()
  const [deleting, setDeleting] = useState<Library>()
  const list = useQuery(adminLibrariesQuery(api))
  const libraries = list.data?.libraries
  const roots = list.data?.libraryPaths ?? []
  // Scans show up as jobs; poll while this page is open.
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => api.admin.getServerStatus({}),
    refetchInterval: 5000
  })
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: adminLibrariesKey })
    void queryClient.invalidateQueries({ queryKey: librariesKey })
    void queryClient.invalidateQueries({ queryKey: statusKey })
  }
  const create = useMutation({
    mutationFn: (d: Draft) => api.admin.createLibrary(d),
    onSuccess: () => {
      setAdding(false)
      changed()
    }
  })
  const update = useMutation({
    mutationFn: (d: Draft & { id: string }) =>
      api.admin.updateLibrary({
        id: d.id,
        name: d.name,
        paths: d.paths,
        updateMask: { paths: ['name', 'paths'] }
      }),
    onSuccess: () => {
      setEditing(undefined)
      changed()
    }
  })
  const scan = useMutation({
    mutationFn: (id: string) => api.admin.scanLibrary({ id }),
    onSuccess: changed
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.admin.deleteLibrary({ id }),
    onSuccess: () => {
      setDeleting(undefined)
      changed()
    }
  })
  const jobs = status.data?.recentJobs ?? []
  const failed = list.error ?? scan.error

  return (
    <section aria-label="Libraries">
      {failed && (
        <p role="alert" className={styles.error}>
          {errorMessage(failed)}
        </p>
      )}
      <ul className={styles.list}>
        {libraries?.map((l) => (
          <li key={l.id} className={styles.card}>
            {editing === l.id ? (
              <LibraryForm
                initial={l}
                roots={roots}
                submitLabel="Save"
                busy={update.isPending}
                error={update.error}
                onSubmit={(d) => update.mutate({ ...d, id: l.id })}
                onCancel={() => setEditing(undefined)}
              />
            ) : (
              <>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>{l.name}</h2>
                  <span className={styles.meta}>{kindNames[l.kind]}</span>
                </div>
                <ul className={styles.paths}>
                  {l.paths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className={styles.meta}>{scanState(l.id, jobs)}</p>
                <div className={styles.actions}>
                  <Button
                    variant="tonal"
                    disabled={scan.isPending}
                    onClick={() => scan.mutate(l.id)}
                  >
                    Scan now
                  </Button>
                  <Button variant="text" onClick={() => setEditing(l.id)}>
                    Edit
                  </Button>
                  <Button variant="text" onClick={() => setDeleting(l)}>
                    Delete
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {libraries?.length === 0 && !adding && (
        <p className={styles.meta}>
          No libraries yet. Add one to start scanning your media.
        </p>
      )}
      {adding ? (
        <div className={styles.card}>
          <LibraryForm
            roots={roots}
            submitLabel="Add library"
            busy={create.isPending}
            error={create.error}
            onSubmit={(d) => create.mutate(d)}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <Button onClick={() => setAdding(true)}>Add library</Button>
      )}
      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={`Delete “${deleting?.name}”?`}
        description="Weir forgets everything it scanned into this library. Files on disk are not touched."
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

/** "Scanning…", or how the last scan went, from the recent jobs. */
function scanState(libraryId: string, jobs: Job[]): string {
  const scans = jobs.filter(
    (j) => j.kind === 'scan_library' && j.libraryId === libraryId
  )
  if (
    scans.some(
      (j) => j.state === JobState.WAITING || j.state === JobState.RUNNING
    )
  )
    return 'Scanning…'
  const last = scans[0]
  if (!last) return ''
  if (last.state === JobState.FAILED)
    return `Last scan failed: ${last.error || 'no reason given'}`
  if (last.state === JobState.COMPLETED)
    return `Last scanned ${when(last.finishedAt)}`
  return ''
}

function LibraryForm({
  initial,
  roots,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel
}: {
  initial?: Library
  // The server's library_paths; every folder must be inside one.
  roots: string[]
  submitLabel: string
  busy: boolean
  error: Error | null
  onSubmit: (d: Draft) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState(initial?.kind ?? LibraryKind.MOVIES)
  const [paths, setPaths] = useState(initial?.paths.join('\n') ?? '')
  const kindId = useId()
  const pathsId = useId()
  const rootsId = useId()
  const list = paths
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ name: name.trim(), kind, paths: list })
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {/* The kind is fixed once a library exists. */}
      {!initial && (
        <div className={styles.field}>
          <label htmlFor={kindId} className={styles.label}>
            Kind
          </label>
          <select
            id={kindId}
            className={styles.select}
            value={kind}
            onChange={(e) => setKind(Number(e.target.value) as LibraryKind)}
          >
            {[LibraryKind.MOVIES, LibraryKind.SHOWS, LibraryKind.MUSIC].map(
              (k) => (
                <option key={k} value={k}>
                  {kindNames[k]}
                </option>
              )
            )}
          </select>
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor={pathsId} className={styles.label}>
          Folders, one per line
        </label>
        <textarea
          id={pathsId}
          className={styles.textarea}
          rows={3}
          placeholder={roots.length ? undefined : '/media/films'}
          aria-describedby={roots.length ? rootsId : undefined}
          value={paths}
          onChange={(e) => setPaths(e.target.value)}
        />
        {roots.length > 0 && (
          <div id={rootsId} className={styles.hint}>
            {roots.length === 1
              ? 'Folders must be inside '
              : 'Folders must be inside one of '}
            {roots.map((r, i) => (
              <span key={r}>
                {i > 0 && ', '}
                <code>{r}</code>
              </span>
            ))}
            . Change these in the server’s <code>library_paths</code> setting.
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {errorMessage(error)}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" disabled={!name.trim() || !list.length || busy}>
          {submitLabel}
        </Button>
        <Button variant="text" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
