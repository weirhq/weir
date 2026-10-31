import { useRouteContext } from '@tanstack/react-router'
import { Button, Dialog, TextField } from '@weirhq/m3e'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { deviceInfo } from '../device'
import { errorMessage } from '../errors'
import styles from './ReauthDialog.module.css'

/** Asks for the password again when an admin call needs a recent sign-in. */
export function ReauthDialog() {
  const { api, session, reauth } = useRouteContext({ from: '__root__' })
  const asking = useSyncExternalStore(reauth.subscribe, () => reauth.asking)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function close(ok: boolean) {
    setPassword('')
    setError('')
    reauth.done(ok)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const { credentials } = await api.auth.login({
        username: session.user?.username ?? '',
        password,
        device: deviceInfo(session.deviceId)
      })
      session.signIn(credentials!)
      close(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={asking}
      onOpenChange={(open) => !open && close(false)}
      title="Confirm it’s you"
      description="Changing server settings needs your password from the last 10 minutes."
    >
      <form className={styles.form} onSubmit={submit}>
        {/* Tells password managers whose password this is. */}
        <input
          type="text"
          autoComplete="username"
          value={session.user?.username ?? ''}
          readOnly
          hidden
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          error={error || undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className={styles.actions}>
          <Button variant="text" type="button" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!password || busy}>
            Continue
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
