import { EditableTable } from './EditableTable.jsx'
import { resolveRowPrices, computeRowAmount, detailsFor, billedLessonCount, payerName, lessonStudentName } from '../lib/rowPricing.js'
import { safeTotalsCsvBytes } from '../lib/csvExport.js'
import { invoiceRecord, invoiceKey, isValidAmount, isLinkUsable, hasFullName, linkInputs } from '../lib/payments.js'
import { rowNeedsRecalc, DEFAULT_LESSON_KEYWORDS, DEFAULT_CANCELLED_KEYWORDS, DEFAULT_PAID_CANCELLATION_PHRASES, DEFAULT_MAKEUP_PHRASES } from '../lib/calendarPayments.js'
import { requestPaymentLink } from '../lib/paymentLinkClient.js'
import styles from './CalculatorPage.module.css'

const PREPARE_CONCURRENCY = 6
// Settings applied at Calculate time; changing one later makes the table stale.
// Compared as calculatePayments applies them, so saving a list that still
// equals its default (null before, the default array after) is no change.
const STALE_DEFAULTS = {
  lesson_keywords: DEFAULT_LESSON_KEYWORDS,
  cancelled_keywords: DEFAULT_CANCELLED_KEYWORDS,
  paid_cancellation_phrases: DEFAULT_PAID_CANCELLATION_PHRASES,
  makeup_phrases: DEFAULT_MAKEUP_PHRASES,
  student_name_regex: null,
  calendar_id: 'primary',
}
const effectiveSetting = (c, k) => JSON.stringify(c?.[k] ?? STALE_DEFAULTS[k])

// Marks rows whose amount isn't final yet, so a low total doesn't look settled.
function csvStatus(row, unresolved, adjusted) {
  const parts = []
  if (row.name_conflicts?.length) parts.push('name conflict')
  if (unresolved > 0) parts.push('needs review')
  if (adjusted) parts.push('adjusted')
  return parts.join('; ')
}

// Runs `worker` over `items` with at most `limit` in flight at once. Each
// item settles independently the moment it's done — a caller updating state
// per item (rather than waiting for the whole batch) is how a crash mid-run
// still leaves everything that finished intact.
async function runWithConcurrency(items, limit, worker) {
  let index = 0
  async function next() {
    const i = index++
    if (i >= items.length) return
    await worker(items[i])
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
}

export function CalculatorPage({ getAccessToken, config, calendar, month, onMonthChange, customPrices, onCustomPriceChange, customerDetails, onCustomerDetailChange, defaultMessage, amountOverrides, onAmountOverrideChange, paymentLinks, onPaymentLinkChange, reviewResolutions, onReviewResolutionChange, preparing, onPreparingChange, prepareStatus, onPrepareStatusChange }) {
  const { rows, summary, loading, error, calculate, calculatedWith } = calendar
  // Link progress is owned by App so leaving the page mid-run can't make
  // finished-looking rows mint a second link when you come back. It is keyed
  // by month too, so an error from one month never shows on another's table.
  const statusMonth = summary?.month ?? month
  const setRowStatus = (student, status) => onPrepareStatusChange?.(prev => ({ ...prev, [invoiceKey(statusMonth, student)]: status }))
  const monthStatus = Object.fromEntries((rows ?? []).map(r => [r.student, prepareStatus?.[invoiceKey(statusMonth, r.student)]]))

  const handleRun = () => calculate(month)

  // A manual amount override is the teacher's final number for the invoice,
  // so it also settles any review items on that row.
  const rowBilling = (row) => {
    const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, customPrices?.[row.student])
    const { amount, unresolved } = computeRowAmount(row, prices, reviewResolutions, summary?.month)
    const override = invoiceRecord(amountOverrides, summary?.month, row)
    return override != null ? { amount: override, unresolved: 0 } : { amount, unresolved }
  }

  const billing = rows?.map(row => ({ row, ...rowBilling(row) })) ?? []
  const liveTotal = Math.round(billing.reduce((sum, b) => sum + b.amount, 0) * 100) / 100
  const needsReview = billing.filter(b => b.unresolved > 0).length
  // Names are matched to saved students at Calculate time; a saved spelling or
  // a conflicting detail added since then can change the row or its safety check.
  const namesStale = rows?.some(r => rowNeedsRecalc(r, customPrices, customerDetails, config?.prices)) ?? false
  // Settings that decide which events count, and how, were applied at
  // Calculate time too.
  const settingsStale = !!calculatedWith && Object.keys(STALE_DEFAULTS).some(k => effectiveSetting(calculatedWith, k) !== effectiveSetting(config, k))
  const stale = !!rows && (namesStale || settingsStale)

  const rowLink = (row, details) => {
    const name = payerName(details, row)
    const lessonStudent = lessonStudentName(row)
    const inputs = linkInputs({ payerName: name, phone: details.phone, lessonStudent, paymentProfile: details.payment_profile, invoiceDescription: details.invoice_description })
    return { name, lessonStudent, inputs }
  }

  const handlePrepareAll = async () => {
    if (!rows?.length || !summary || preparing || stale) return
    const eligible = billing
      .filter(({ unresolved, row }) => unresolved === 0 && !row.name_conflicts?.length && monthStatus[row.student] !== 'loading')
      .map(({ row, amount }) => {
        const details = detailsFor(customerDetails, row)
        return { row, details, phone: details.phone, amount, ...rowLink(row, details) }
      })
      .filter(({ phone, name, amount, row, inputs }) =>
        phone && hasFullName(name) && isValidAmount(amount) && !isLinkUsable(paymentLinks, summary.month, row, amount, inputs)
      )
    if (!eligible.length) return

    onPreparingChange?.(true)
    onPrepareStatusChange?.(prev => {
      const next = { ...prev }
      for (const { row } of eligible) next[invoiceKey(summary.month, row.student)] = 'loading'
      return next
    })

    await runWithConcurrency(eligible, PREPARE_CONCURRENCY, async ({ row, details, phone, name, lessonStudent, inputs, amount }) => {
      try {
        const link = await requestPaymentLink(getAccessToken, {
          studentName: name,
          lessonStudent,
          phone,
          amount,
          month: summary.month,
          numberOfLessons: billedLessonCount(row, reviewResolutions, summary.month),
          paymentProfile: details.payment_profile,
          invoiceDescription: details.invoice_description,
        })
        await onPaymentLinkChange?.(summary.month, row.student, link, amount, inputs)
        setRowStatus(row.student, null)
      } catch (err) {
        setRowStatus(row.student, { error: err.message || 'Failed to create the link. Try again.' })
      }
    })

    onPreparingChange?.(false)
  }

  const handleDownload = () => {
    if (!rows?.length) return
    // The CSV carries the amounts the table shows (review answers and manual
    // adjustments included), not the bare lesson totals from calculation.
    const bytes = safeTotalsCsvBytes(billing.map(({ row, amount, unresolved }) => ({
      ...row,
      amount_due: amount,
      status: csvStatus(row, unresolved, invoiceRecord(amountOverrides, summary?.month, row) != null),
    })))
    const blob = new Blob([bytes], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lessons-${summary?.month ?? month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Lesson Calculator</h2>
      <div className={styles.controls}>
        <input
          type="month"
          className={styles.monthInput}
          value={month}
          onChange={e => onMonthChange(e.target.value)}
        />
        <button className={styles.btnPrimary} onClick={handleRun} disabled={loading}>
          {loading ? 'Loading…' : 'Calculate'}
        </button>
        {rows?.length > 0 && (
          <button className={styles.btnSecondary} onClick={handleDownload}>
            Download CSV
          </button>
        )}
        {rows?.length > 0 && (
          <button className={styles.btnSecondary} onClick={handlePrepareAll} disabled={preparing || stale} title={stale ? 'Press Calculate again first' : undefined}>
            {preparing ? 'Preparing links…' : 'Prepare all links'}
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {summary && (
        <div className={styles.summaryBar}>
          <span>{summary.month}</span>
          <span>{summary.students} students</span>
          <span className={styles.total}>Total: ₪{liveTotal}</span>
          {needsReview > 0 && (
            <span className={styles.reviewNote}>
              {needsReview} {needsReview === 1 ? 'student needs' : 'students need'} review before sending
            </span>
          )}
        </div>
      )}

      {stale && (
        <div className={styles.staleNote} role="status">
          {namesStale && settingsStale ? 'Saved students and Settings' : namesStale ? 'Saved students' : 'Settings'} changed since this calculation. Press Calculate again before sending; links and WhatsApp are paused until then.
        </div>
      )}

      {rows?.length > 0 && (
        <EditableTable
          rows={rows}
          config={config}
          customPrices={customPrices}
          onCustomPriceChange={onCustomPriceChange}
          customerDetails={customerDetails}
          onCustomerDetailChange={onCustomerDetailChange}
          month={summary?.month ?? month}
          defaultMessage={defaultMessage}
          amountOverrides={amountOverrides}
          onAmountOverrideChange={onAmountOverrideChange}
          paymentLinks={paymentLinks}
          onPaymentLinkChange={onPaymentLinkChange}
          getAccessToken={getAccessToken}
          prepareStatus={monthStatus}
          onRowStatusChange={setRowStatus}
          sendBlocked={stale}
          reviewResolutions={reviewResolutions}
          onReviewResolutionChange={onReviewResolutionChange}
        />
      )}

      {rows?.length === 0 && !loading && (
        <div className={styles.empty}>No lessons found for {month}.</div>
      )}
    </div>
  )
}
