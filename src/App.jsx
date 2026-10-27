import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAuth } from './hooks/useAuth.js'
import { useUserSettings } from './hooks/useUserSettings.js'
import { useCalendarData } from './hooks/useCalendarData.js'
import { loadAmountOverrides, saveAmountOverride, loadPaymentLinks, savePaymentLink, loadReviewResolutions, saveReviewResolution } from './lib/payments.js'
import { AuthScreen } from './components/AuthScreen.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { CalculatorPage } from './components/CalculatorPage.jsx'
import { CustomPricesPage } from './components/CustomPricesPage.jsx'
import { SettingsPage } from './components/SettingsPage.jsx'
import styles from './App.module.css'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function App() {
  const { accessToken, userEmail, signIn, signOut, error: authError, getValidAccessToken } = useAuth()
  const { settings, saveSettings, isReady } = useUserSettings(userEmail)
  const [page, setPage] = useState('calculator')
  const [config, setConfig] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [amountOverrides, setAmountOverrides] = useState({})
  const [paymentLinks, setPaymentLinks] = useState({})
  const [reviewResolutions, setReviewResolutions] = useState({})
  const [month, setMonth] = useState(currentMonth)
  // Payment-link progress per student; kept here (not in CalculatorPage) so a
  // run that is still in flight when you change pages stays visible.
  const [preparing, setPreparing] = useState(false)
  const [prepareStatus, setPrepareStatus] = useState({})

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

  useEffect(() => {
    if (!userEmail) return
    loadAmountOverrides(userEmail).then(setAmountOverrides).catch(err => console.error('Failed to load amount overrides:', err))
    loadPaymentLinks(userEmail).then(setPaymentLinks).catch(err => console.error('Failed to load payment links:', err))
    loadReviewResolutions(userEmail).then(setReviewResolutions).catch(err => console.error('Failed to load review answers:', err))
  }, [userEmail])

  const handleAmountOverrideChange = async (month, student, amount) => {
    const next = await saveAmountOverride(userEmail, month, student, amount)
    setAmountOverrides(next)
  }

  const handlePaymentLinkChange = async (month, student, link, amount, inputs) => {
    const next = await savePaymentLink(userEmail, month, student, link, amount, inputs)
    setPaymentLinks(next)
  }

  const handleReviewResolutionChange = async (itemKey, resolution) => {
    const next = await saveReviewResolution(userEmail, itemKey, resolution)
    setReviewResolutions(next)
  }

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
    const hasLessonKeywords = settings.lesson_keywords != null
    const hasMakeupPhrases = settings.makeup_phrases != null
    if (!hasCustomDefaults && !hasCustomPhrases && !hasCustomKeywords && !hasLessonKeywords && !hasMakeupPhrases) return config
    return {
      ...config,
      ...(hasCustomDefaults ? { prices: settings.default_prices } : {}),
      ...(hasCustomPhrases ? { paid_cancellation_phrases: settings.paid_cancellation_phrases } : {}),
      ...(hasCustomKeywords ? { cancelled_keywords: settings.cancelled_keywords } : {}),
      ...(hasLessonKeywords ? { lesson_keywords: settings.lesson_keywords } : {}),
      ...(hasMakeupPhrases ? { makeup_phrases: settings.makeup_phrases } : {}),
    }
  }, [config, settings.default_prices, settings.paid_cancellation_phrases, settings.cancelled_keywords, settings.lesson_keywords, settings.makeup_phrases])

  // The calculation lives here, not in CalculatorPage, so it survives both
  // navigating to Settings / Custom Prices and a forced re-authentication
  // (App stays mounted behind the AuthScreen gate). Amounts are re-derived
  // from live prices on render, so edits made elsewhere still show up.
  const calcConfig = useMemo(() => effectiveConfig && {
    ...effectiveConfig,
    custom_prices: settings.custom_prices,
    customer_details: settings.customer_details,
  }, [effectiveConfig, settings.custom_prices, settings.customer_details])
  const calendar = useCalendarData(getValidAccessToken, calcConfig)
  const { reset: resetCalculation } = calendar
  const knownStudents = useMemo(() => calendar.rows?.map(r => r.student) ?? [], [calendar.rows])

  // A re-auth signs the same account back in and keeps the table; a different
  // account must never see the previous one's students.
  const lastEmailRef = useRef(null)
  const resetForAccount = useCallback(() => {
    resetCalculation()
    setPrepareStatus({})
    setPreparing(false)
  }, [resetCalculation])
  useEffect(() => {
    if (!userEmail) return
    if (lastEmailRef.current && lastEmailRef.current !== userEmail) resetForAccount()
    lastEmailRef.current = userEmail
  }, [userEmail, resetForAccount])

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
            getAccessToken={getValidAccessToken}
            config={effectiveConfig}
            calendar={calendar}
            month={month}
            onMonthChange={setMonth}
            customPrices={settings.custom_prices}
            onCustomPriceChange={handleCustomPriceChange}
            customerDetails={settings.customer_details}
            onCustomerDetailChange={handleCustomerDetailChange}
            defaultMessage={settings.default_message}
            amountOverrides={amountOverrides}
            onAmountOverrideChange={handleAmountOverrideChange}
            paymentLinks={paymentLinks}
            onPaymentLinkChange={handlePaymentLinkChange}
            preparing={preparing}
            onPreparingChange={setPreparing}
            prepareStatus={prepareStatus}
            onPrepareStatusChange={setPrepareStatus}
            reviewResolutions={reviewResolutions}
            onReviewResolutionChange={handleReviewResolutionChange}
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
