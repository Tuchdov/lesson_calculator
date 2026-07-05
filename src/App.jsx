import { useState, useEffect, useMemo } from 'react'
import { useAuth } from './hooks/useAuth.js'
import { useUserSettings } from './hooks/useUserSettings.js'
import { AuthScreen } from './components/AuthScreen.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { CalculatorPage } from './components/CalculatorPage.jsx'
import { CustomPricesPage } from './components/CustomPricesPage.jsx'
import { SettingsPage } from './components/SettingsPage.jsx'
import styles from './App.module.css'

export default function App() {
  const { accessToken, userEmail, signIn, signOut, error: authError } = useAuth()
  const { settings, saveSettings, isReady } = useUserSettings(userEmail)
  const [page, setPage] = useState('calculator')
  const [config, setConfig] = useState(null)
  const [knownStudents, setKnownStudents] = useState([])
  const [dirty, setDirty] = useState(false)

  // Guards navigation away from a page with unsaved changes (currently only
  // Custom Prices reports dirty state, e.g. a pending import not yet saved).
  // Confirming discards the flag and switches; cancelling leaves the user
  // exactly where they were, changes intact.
  const handleNavigate = (nextPage) => {
    if (nextPage === page) return
    if (dirty && !window.confirm('You have unsaved changes on this page. Discard them?')) return
    setDirty(false)
    setPage(nextPage)
  }

  useEffect(() => {
    fetch('/pricing_config.json')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {})
  }, [])

  const handleCustomPriceChange = async (student, prices) => {
    const next = {
      ...settings,
      custom_prices: { ...settings.custom_prices, [student]: prices },
    }
    await saveSettings(next)
  }

  const handleCustomerDetailChange = async (student, details) => {
    const next = {
      ...settings,
      customer_details: {
        ...settings.customer_details,
        [student]: { ...settings.customer_details?.[student], ...details },
      },
    }
    await saveSettings(next)
  }

  const effectiveConfig = useMemo(() => {
    if (!config) return config
    const hasCustomDefaults = settings.default_prices?.regular && settings.default_prices?.non_regular
    const hasCustomPhrases = settings.paid_cancellation_phrases != null
    const hasCustomKeywords = settings.cancelled_keywords != null
    if (!hasCustomDefaults && !hasCustomPhrases && !hasCustomKeywords) return config
    return {
      ...config,
      ...(hasCustomDefaults ? { prices: settings.default_prices } : {}),
      ...(hasCustomPhrases ? { paid_cancellation_phrases: settings.paid_cancellation_phrases } : {}),
      ...(hasCustomKeywords ? { cancelled_keywords: settings.cancelled_keywords } : {}),
    }
  }, [config, settings.default_prices, settings.paid_cancellation_phrases, settings.cancelled_keywords])

  if (!accessToken) {
    return <AuthScreen onSignIn={signIn} error={authError} />
  }

  if (!config || !isReady) {
    return (
      <div className={styles.loading}>
        <span className={styles.spinner} />
        Loading…
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <Sidebar page={page} onNavigate={handleNavigate} userEmail={userEmail} onSignOut={signOut} />
      <main className={styles.main}>
        {page === 'calculator' && (
          <CalculatorPage
            accessToken={accessToken}
            config={effectiveConfig}
            customPrices={settings.custom_prices}
            onCustomPriceChange={handleCustomPriceChange}
            onStudentsChange={setKnownStudents}
            customerDetails={settings.customer_details}
            onCustomerDetailChange={handleCustomerDetailChange}
            defaultMessage={settings.default_message}
          />
        )}
        {page === 'custom-prices' && (
          <CustomPricesPage
            settings={settings}
            onSave={saveSettings}
            availableStudents={knownStudents}
            onDirtyChange={setDirty}
          />
        )}
        {page === 'settings' && (
          <SettingsPage
            config={config}
            settings={settings}
            onSave={saveSettings}
          />
        )}
      </main>
    </div>
  )
}
