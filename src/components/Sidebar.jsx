import styles from './Sidebar.module.css'

const NAV_ITEMS = [
  { id: 'calculator', label: 'Calculator', icon: '📊' },
  { id: 'custom-prices', label: 'Custom Prices', icon: '✏️' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

export function Sidebar({ page, onNavigate, userEmail, onSignOut }) {
  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandTitle}>Lesson Calc</span>
      </div>
      <ul className={styles.nav}>
        {NAV_ITEMS.map(item => (
          <li key={item.id}>
            <button
              className={`${styles.navBtn} ${page === item.id ? styles.active : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        {userEmail && <p className={styles.email}>{userEmail}</p>}
        <button className={styles.signOut} onClick={onSignOut}>Sign out</button>
      </div>
    </nav>
  )
}
