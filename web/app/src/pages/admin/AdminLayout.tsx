import { Link, Outlet } from '@tanstack/react-router'
import cards from '../../components/Cards.module.css'
import styles from './Admin.module.css'

/** Server settings, for admins: libraries, users and the server's health. */
export function AdminLayout() {
  return (
    <div className={styles.page}>
      <h1 className={cards.heading}>Server settings</h1>
      <nav className={styles.tabs} aria-label="Server settings">
        {(
          [
            ['/admin', 'Libraries'],
            ['/admin/users', 'Users'],
            ['/admin/status', 'Status']
          ] as const
        ).map(([to, label]) => (
          <Link
            key={to}
            to={to}
            className={styles.tab}
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
