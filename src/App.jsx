import { useState, useEffect } from 'react'
import { useAuth } from './hooks/useAuth.js'
import { useUserSettings } from './hooks/useUserSettings.js'
import { AuthScreen } from './components/AuthScreen.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { CalculatorPage } from './components/CalculatorPage.jsx'
import { CustomPricesPage } from './components/CustomPricesPage.jsx'
import styles from './App.module.css'

export default function App() {
  const { accessToken, userEmail, signIn, signOut, error: authError } = useAuth()
  const { settings, saveSettings, isReady } = useUserSettings(userEmail)
  const [page, setPage] = useState('calculator')
  const [config, setConfig] = useState(null)
  const [knownStudents, setKnownStudents] = useState([])

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
      customer_details: { ...settings.customer_details, [student]: details },
    }
    await saveSettings(next)
  }

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
      <Sidebar page={page} onNavigate={setPage} userEmail={userEmail} onSignOut={signOut} />
      <main className={styles.main}>
        {page === 'calculator' && (
          <CalculatorPage
            accessToken={accessToken}
            config={config}
            customPrices={settings.custom_prices}
            onCustomPriceChange={handleCustomPriceChange}
            onStudentsChange={setKnownStudents}
            customerDetails={settings.customer_details}
            onCustomerDetailChange={handleCustomerDetailChange}
          />
        )}
        {page === 'custom-prices' && (
          <CustomPricesPage
            settings={settings}
            onSave={saveSettings}
            availableStudents={knownStudents}
          />
        )}
      </main>
    </div>
  )
}
