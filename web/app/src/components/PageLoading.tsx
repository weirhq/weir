import { LoadingIndicator } from '@weirhq/m3e'
import { useEffect, useState } from 'react'
import styles from './PageLoading.module.css'

/**
 * A loading indicator in the middle of the page while it loads, shown only
 * once the wait passes 400ms, so quick loads don't flash.
 */
export function PageLoading() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 400)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className={styles.page}>
      {shown && <LoadingIndicator aria-label="Loading" />}
    </div>
  )
}
