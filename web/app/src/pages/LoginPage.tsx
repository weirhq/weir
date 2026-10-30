import { Button, TextField } from '@weirhq/ui'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { deviceInfo } from '../device'
import { errorMessage } from '../errors'
import styles from './Page.module.css'

export function LoginPage() {
  const { api, session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { credentials } = await api.auth.login({
        username,
        password,
        device: deviceInfo(session.deviceId)
      })
      if (credentials) session.signIn(credentials)
      await navigate({ to: '/' })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className={styles.centered}>
      <form className={`${styles.card} ${styles.form}`} onSubmit={submit}>
        <h1 className={styles.title}>Sign in to Weir</h1>
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
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={busy}>
            Sign in
          </Button>
        </div>
      </form>
    </main>
  )
}
