import { Link, Outlet } from '@tanstack/react-router'
import { TabLink, TabNav } from '@weirhq/m3e'
import cards from '../../components/Cards.module.css'
import styles from './Admin.module.css'

/** Server settings, for admins: libraries, users and the server's health. */
export function AdminLayout() {
  return (
    <div className={styles.page}>
      <h1 className={cards.heading}>Server settings</h1>
      <TabNav aria-label="Server settings">
        {(
          [
            ['/admin', 'Libraries'],
            ['/admin/users', 'Users'],
            ['/admin/status', 'Status']
          ] as const
        ).map(([to, label]) => (
          <TabLink key={to} label={label}>
            <Link
              to={to}
              activeOptions={{ exact: true }}
              activeProps={{ 'aria-current': 'page' }}
            />
          </TabLink>
        ))}
      </TabNav>
      <Outlet />
    </div>
  )
}
