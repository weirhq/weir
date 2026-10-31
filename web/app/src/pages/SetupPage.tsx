import { Button, TextField } from '@weirhq/m3e'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { deviceInfo } from '../device'
import { errorMessage } from '../errors'
import { setupStateKey } from '../router'
import styles from './Page.module.css'

const MIN_PASSWORD_LENGTH = 8

/** First run: create the admin account. */
export function SetupPage() {
  const { api, session, queryClient } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const passwordError =
    password && password.length < MIN_PASSWORD_LENGTH
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : undefined
  const confirmError =
    confirm && confirm !== password ? "Passwords don't match." : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (passwordError || confirmError) return
    setBusy(true)
    setError('')
    try {
      const { credentials } = await api.auth.bootstrap({
        username,
        displayName,
        password,
        device: deviceInfo(session.deviceId)
      })
      if (credentials) session.signIn(credentials)
      queryClient.setQueryData(setupStateKey, { needsBootstrap: false })
      await navigate({ to: '/' })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className={styles.centered}>
      <form className={`${styles.card} ${styles.form}`} onSubmit={submit}>
        <h1 className={styles.title}>Set up Weir</h1>
        <p className={styles.lead}>
          Create the admin account for this server. You can add other people
          after.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <TextField
          label="Username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label="Display name (optional)"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          error={passwordError}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          error={confirmError}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={busy}>
            Create account
          </Button>
        </div>
      </form>
    </main>
  )
}
