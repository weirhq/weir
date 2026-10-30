import { Button } from '@weirhq/ui'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import styles from './Page.module.css'

export function HomePage() {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const user = useSyncExternalStore(session.subscribe, () => session.user)

  async function signOut() {
    await session.signOut()
    await navigate({ to: '/login' })
  }

  return (
    <>
      <header className={styles.appBar}>
        <h1 className={styles.appTitle}>Weir</h1>
        <div className={styles.user}>
          <span>{user?.displayName}</span>
          <Button variant="text" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className={styles.empty}>
        <h2 className={styles.title}>No libraries yet</h2>
        <p className={styles.lead}>Libraries you add will show up here.</p>
      </main>
    </>
  )
}
