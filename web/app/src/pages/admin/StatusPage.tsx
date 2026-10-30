import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { errorMessage } from '../../errors'
import { JobState } from '../../gen/weir/api/v1alpha/admin_pb'
import { adminLibrariesQuery, statusKey, when } from './keys'
import styles from './Admin.module.css'

const jobNames: Record<string, string> = {
  scan_library: 'Scan',
  refresh_metadata: 'Metadata refresh'
}

const stateNames: Record<JobState, string> = {
  [JobState.UNSPECIFIED]: '',
  [JobState.WAITING]: 'Waiting',
  [JobState.RUNNING]: 'Running',
  [JobState.COMPLETED]: 'Done',
  [JobState.FAILED]: 'Failed',
  [JobState.CANCELLED]: 'Cancelled'
}

/** The engine's health and capabilities, and the latest background jobs. */
export function StatusPage() {
  const { api } = useRouteContext({ from: '__root__' })
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => api.admin.getServerStatus({}),
    refetchInterval: 5000
  })
  const libraries = useQuery({
    ...adminLibrariesQuery(api),
    select: (r) => r.libraries
  })
  if (status.error)
    return (
      <p role="alert" className={styles.error}>
        {errorMessage(status.error)}
      </p>
    )
  const engine = status.data?.engine
  const jobs = status.data?.recentJobs ?? []
  const libraryName = (id: string) =>
    libraries.data?.find((l) => l.id === id)?.name ?? ''

  return (
    <>
      <section className={styles.card} aria-label="Engine">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Engine</h2>
          {engine && (
            <span
              className={engine.healthy ? styles.ok : styles.bad}
              role="status"
            >
              {engine.healthy
                ? 'Running'
                : engine.problem
                  ? 'Not compatible'
                  : 'Not responding'}
            </span>
          )}
        </div>
        {engine?.problem && (
          <p role="alert" className={styles.error}>
            {engine.problem}
          </p>
        )}
        {engine && (
          <dl className={styles.facts}>
            <dt>Version</dt>
            <dd>{engine.engineVersion || 'Unknown'}</dd>
            <dt>ffmpeg</dt>
            <dd>{engine.ffmpegVersion || 'Unknown'}</dd>
            <dt>Playback sessions</dt>
            <dd>
              {engine.activeSessions} of {engine.maxSessions}
            </dd>
            <dt>Hardware</dt>
            <dd>
              {engine.hardware.length
                ? engine.hardware.join(', ')
                : 'None in use; converting on the processor'}
            </dd>
          </dl>
        )}
      </section>
      <section aria-label="Recent jobs">
        <h2 className={styles.cardTitle}>Recent jobs</h2>
        {status.data && jobs.length === 0 ? (
          <p className={styles.meta}>Nothing has run yet.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Library</th>
                  <th scope="col">State</th>
                  <th scope="col">Started</th>
                  <th scope="col">Finished</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{jobNames[j.kind] ?? j.kind}</td>
                    <td>{libraryName(j.libraryId)}</td>
                    <td>
                      {stateNames[j.state]}
                      {j.attempt > 1 && ` (attempt ${j.attempt})`}
                      {j.error && (
                        <span className={styles.jobError}>{j.error}</span>
                      )}
                    </td>
                    <td>{when(j.createdAt)}</td>
                    <td>{when(j.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
