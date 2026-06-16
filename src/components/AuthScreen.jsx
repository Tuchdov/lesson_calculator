import styles from './AuthScreen.module.css'

export function AuthScreen({ onSignIn, error }) {
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#e8f0fe"/>
            <path d="M24 12c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12S30.627 12 24 12zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 17.2c-3.333 0-6.29-1.698-8.1-4.3.04-2.67 5.4-4.14 8.1-4.14 2.7 0 8.06 1.47 8.1 4.14-1.81 2.602-4.767 4.3-8.1 4.3z" fill="#1a73e8"/>
          </svg>
        </div>
        <h1 className={styles.title}>Lesson Calculator</h1>
        <p className={styles.subtitle}>Sign in with Google to access your Calendar</p>
        {error && <div className={styles.error}>{error}</div>}
        <button className={styles.btn} onClick={onSignIn}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.167 6.656 3.58 9 3.58z"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>
  )
}
