import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAuth } from './hooks/useAuth.js'
import { useUserSettings } from './hooks/useUserSettings.js'
import { useCalendarData } from './hooks/useCalendarData.js'
import { normalizeStudentName, currentMonthKey, addStudentMerge, removeStudentMerge } from './lib/calendarPayments.js'
import { loadCalculation, saveCalculation } from './lib/calculationStore.js'
import { loadAmountOverrides, saveAmountOverride, loadLessonOverrides, saveLessonOverride, loadPaymentLinks, savePaymentLink, loadReviewResolutions, saveReviewResolution, loadTierOverrides, saveTierOverride, loadExcludedStudents, saveExcludedStudent } from './lib/payments.js'
import { AuthScreen } from './components/AuthScreen.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { CalculatorPage } from './components/CalculatorPage.jsx'
import { CustomPricesPage } from './components/CustomPricesPage.jsx'
import { SettingsPage } from './components/SettingsPage.jsx'
import styles from './App.module.css'

/**
 * Root component: owns auth, settings and the per-account override stores, and
 * routes between the calculator, custom prices and settings pages.
 * @returns {import('react').ReactNode} The signed-in app, or the sign-in screen.
 */
export default function App() {
  const { accessToken, userEmail, signIn, signOut, error: authError, getValidAccessToken } = useAuth()
  const { settings, saveSettings, isReady } = useUserSettings(userEmail)
  const [page, setPage] = useState('calculator')
  const [config, setConfig] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [amountOverrides, setAmountOverrides] = useState({})
  const [lessonOverrides, setLessonOverrides] = useState({})
  const [paymentLinks, setPaymentLinks] = useState({})
  const [reviewResolutions, setReviewResolutions] = useState({})
  const [tierOverrides, setTierOverrides] = useState({})
  const [excludedStudents, setExcludedStudents] = useState({})
  const [month, setMonth] = useState(currentMonthKey)
  // Payment-link progress per student; kept here (not in CalculatorPage) so a
  // run that is still in flight when you change pages stays visible.
  const [preparing, setPreparing] = useState(false)
  const [prepareStatus, setPrepareStatus] = useState({})
  // The account the in-memory state belongs to (see resetForAccount).
  const lastEmailRef = useRef(null)

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

  // Each account's stores replace the previous account's, which are cleared
  // first so none of its discounts, amounts or links apply meanwhile. A load
  // that finishes after the account changed is discarded, so a slow load for
  // an earlier account can't overwrite the current one's.
  useEffect(() => {
    if (!userEmail) return
    let current = true
    const stores = [
      [loadAmountOverrides, setAmountOverrides, 'amount overrides'],
      [loadLessonOverrides, setLessonOverrides, 'lesson overrides'],
      [loadPaymentLinks, setPaymentLinks, 'payment links'],
      [loadReviewResolutions, setReviewResolutions, 'review answers'],
      [loadTierOverrides, setTierOverrides, 'price tier overrides'],
      [loadExcludedStudents, setExcludedStudents, 'removed students'],
    ]
    for (const [load, set, label] of stores) {
      set({})
      load(userEmail)
        .then(value => { if (current) set(value) })
        .catch(err => console.error(`Failed to load ${label}:`, err))
    }
    return () => { current = false }
  }, [userEmail])

  // A Prepare-all run that finishes after a switch to another account must not
  // write the previous account's links or progress into this one's state.
  const sameAccount = (email) => lastEmailRef.current === email
  const handlePaymentLinkChange = async (month, student, link, amount, inputs) => {
    const email = userEmail
    const next = await savePaymentLink(email, month, student, link, amount, inputs)
    if (sameAccount(email)) setPaymentLinks(next)
  }
  const handlePrepareStatusChange = (update) => {
    if (sameAccount(userEmail)) setPrepareStatus(update)
  }
  const handlePreparingChange = (value) => {
    if (sameAccount(userEmail)) setPreparing(value)
  }

  const handleAmountOverrideChange = async (month, student, amount) => {
    const email = userEmail
    const next = await saveAmountOverride(email, month, student, amount)
    if (sameAccount(email)) setAmountOverrides(next)
  }

  const handleTierOverrideChange = async (month, student, tier) => {
    const email = userEmail
    const next = await saveTierOverride(email, month, student, tier)
    if (sameAccount(email)) setTierOverrides(next)
  }

  const handleExcludedStudentChange = async (month, student, excluded) => {
    const email = userEmail
    const next = await saveExcludedStudent(email, month, student, excluded)
    if (sameAccount(email)) setExcludedStudents(next)
  }

  /**
   * Persists a lesson-count override (or clears it with null) and, if the same
   * account is still signed in, refreshes the in-memory copy.
   * @param {string} month Month key of the invoice.
   * @param {string} student Student name the override is saved under.
   * @param {object | null} counts Replacement lesson counts, or null to clear.
   * @returns {Promise<void>}
   */
  const handleLessonOverrideChange = async (month, student, counts) => {
    const email = userEmail
    const next = await saveLessonOverride(email, month, student, counts)
    if (sameAccount(email)) setLessonOverrides(next)
  }

  const handleReviewResolutionChange = async (itemKey, resolution) => {
    const email = userEmail
    const next = await saveReviewResolution(email, itemKey, resolution)
    if (sameAccount(email)) setReviewResolutions(next)
  }

  // `students` is every saved spelling the new rate applies to; one save, so
  // the spellings can't overwrite each other through a stale `settings`.
  const handleCustomPriceChange = async (students, prices) => {
    const custom_prices = { ...settings.custom_prices }
    for (const student of [].concat(students)) custom_prices[student] = prices
    await saveSettings({ ...settings, custom_prices })
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
    const hasMerges = Object.keys(settings.student_merges ?? {}).length > 0
    if (!hasCustomDefaults && !hasCustomPhrases && !hasCustomKeywords && !hasLessonKeywords && !hasMakeupPhrases && !hasMerges) return config
    return {
      ...config,
      ...(hasCustomDefaults ? { prices: settings.default_prices } : {}),
      ...(hasCustomPhrases ? { paid_cancellation_phrases: settings.paid_cancellation_phrases } : {}),
      ...(hasCustomKeywords ? { cancelled_keywords: settings.cancelled_keywords } : {}),
      ...(hasLessonKeywords ? { lesson_keywords: settings.lesson_keywords } : {}),
      ...(hasMakeupPhrases ? { makeup_phrases: settings.makeup_phrases } : {}),
      ...(hasMerges ? { student_merges: settings.student_merges } : {}),
    }
  }, [config, settings.default_prices, settings.paid_cancellation_phrases, settings.cancelled_keywords, settings.lesson_keywords, settings.makeup_phrases, settings.student_merges])

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
  const { reset: resetCalculation, restore: restoreCalculation, rows: calcRows, summary: calcSummary, calculatedWith } = calendar

  // The last calculation comes back when the site is opened again, with its
  // month, unless a new one was started meanwhile. A load for an earlier
  // account is discarded.
  useEffect(() => {
    if (!userEmail) return
    let current = true
    loadCalculation(userEmail)
      .then(saved => { if (current && saved && restoreCalculation(saved)) setMonth(saved.summary.month) })
      .catch(err => console.error('Failed to load the last calculation:', err))
    return () => { current = false }
  }, [userEmail, restoreCalculation])

  /**
   * Bills `from` as `into` from now on and recalculates the month, so the
   * table shows them as one student straight away.
   * @param {string} from The row key of the student merged away.
   * @param {string} into The row key of the student that bills.
   * @returns {Promise<void>}
   */
  const handleMergeStudents = async (from, into) => {
    const student_merges = addStudentMerge(settings.student_merges, from, into)
    await saveSettings({ ...settings, student_merges })
    await calendar.calculate(calcSummary?.month ?? month, { ...calcConfig, student_merges })
  }

  /**
   * Gives a merged calendar name its own row again and recalculates the month.
   * @param {string} name The merged calendar name.
   * @returns {Promise<void>}
   */
  const handleUnmergeStudent = async (name) => {
    const student_merges = removeStudentMerge(settings.student_merges, name)
    await saveSettings({ ...settings, student_merges })
    await calendar.calculate(calcSummary?.month ?? month, { ...calcConfig, student_merges })
  }
  // Every spelling a row answers to, so an imported price under the plain
  // calendar name (no notes or ages) isn't reported as unmatched.
  const knownStudents = useMemo(() => [...new Set((calendar.rows ?? []).flatMap(r => [r.student, normalizeStudentName(r.student), ...(r.aliases ?? [])]))], [calendar.rows])

  // A re-auth signs the same account back in and keeps the table; a different
  // account must never see the previous one's students.
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

  // Saved under the account it was calculated for (lastEmailRef, updated just
  // above), not the one signing in: on an account switch the rows don't change
  // in that render, and they are cleared before the next account's are shown.
  useEffect(() => {
    const email = lastEmailRef.current
    if (!email || !calcRows || !calcSummary) return
    saveCalculation(email, { rows: calcRows, summary: calcSummary, calculatedWith })
      .catch(err => console.error('Failed to save the calculation:', err))
  }, [calcRows, calcSummary, calculatedWith])

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
            defaultInvoiceDescription={settings.default_invoice_description}
            previewImage={settings.preview_image}
            amountOverrides={amountOverrides}
            onAmountOverrideChange={handleAmountOverrideChange}
            tierOverrides={tierOverrides}
            onTierOverrideChange={handleTierOverrideChange}
            lessonOverrides={lessonOverrides}
            onLessonOverrideChange={handleLessonOverrideChange}
            excludedStudents={excludedStudents}
            onExcludedStudentChange={handleExcludedStudentChange}
            paymentLinks={paymentLinks}
            onPaymentLinkChange={handlePaymentLinkChange}
            preparing={preparing}
            onPreparingChange={handlePreparingChange}
            prepareStatus={prepareStatus}
            onPrepareStatusChange={handlePrepareStatusChange}
            reviewResolutions={reviewResolutions}
            onReviewResolutionChange={handleReviewResolutionChange}
            onMergeStudents={handleMergeStudents}
            onUnmergeStudent={handleUnmergeStudent}
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
            getAccessToken={getValidAccessToken}
          />
        )}
      </main>
    </div>
  )
}
