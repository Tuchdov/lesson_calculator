import { useState } from 'react'
import { EditableTable } from './EditableTable.jsx'
import { resolveRowPrices, computeRowAmount, detailsFor, totalLessons } from '../lib/rowPricing.js'
import { safeTotalsCsvBytes } from '../lib/csvExport.js'
import { getStoredOverride, isValidAmount, isLinkUsable, hasFullName } from '../lib/payments.js'
import { requestPaymentLink } from '../lib/paymentLinkClient.js'
import styles from './CalculatorPage.module.css'

const PREPARE_CONCURRENCY = 6

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

export function CalculatorPage({ getAccessToken, config, calendar, month, onMonthChange, customPrices, onCustomPriceChange, customerDetails, onCustomerDetailChange, defaultMessage, amountOverrides, onAmountOverrideChange, paymentLinks, onPaymentLinkChange, reviewResolutions, onReviewResolutionChange }) {
  const { rows, summary, loading, error, calculate } = calendar
  const [preparing, setPreparing] = useState(false)
  const [prepareStatus, setPrepareStatus] = useState({})

  const handleRun = () => calculate(month)

  // A manual amount override is the teacher's final number for the invoice,
  // so it also settles any review items on that row.
  const rowBilling = (row) => {
    const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, customPrices?.[row.student])
    const { amount, unresolved } = computeRowAmount(row, prices, reviewResolutions, summary?.month)
    const override = getStoredOverride(amountOverrides, summary?.month, row.student)
    return override != null ? { amount: override, unresolved: 0 } : { amount, unresolved }
  }

  const billing = rows?.map(row => ({ row, ...rowBilling(row) })) ?? []
  const liveTotal = Math.round(billing.reduce((sum, b) => sum + b.amount, 0) * 100) / 100
  const needsReview = billing.filter(b => b.unresolved > 0).length

  const handlePrepareAll = async () => {
    if (!rows?.length || !summary || preparing) return
    const eligible = billing
      .filter(({ unresolved }) => unresolved === 0)
      .map(({ row, amount }) => {
        const details = detailsFor(customerDetails, row)
        return { row, details, phone: details.phone, name: details.full_name || row.student, amount }
      })
      .filter(({ phone, name, amount, row }) =>
        phone && hasFullName(name) && isValidAmount(amount) && !isLinkUsable(paymentLinks, summary.month, row.student, amount)
      )
    if (!eligible.length) return

    setPreparing(true)
    setPrepareStatus(prev => {
      const next = { ...prev }
      for (const { row } of eligible) next[row.student] = 'loading'
      return next
    })

    await runWithConcurrency(eligible, PREPARE_CONCURRENCY, async ({ row, details, phone, name, amount }) => {
      try {
        const link = await requestPaymentLink(getAccessToken, {
          studentName: name,
          phone,
          amount,
          month: summary.month,
          numberOfLessons: totalLessons(row),
          paymentProfile: details.payment_profile,
          invoiceDescription: details.invoice_description,
        })
        await onPaymentLinkChange?.(summary.month, row.student, link, amount)
        setPrepareStatus(prev => ({ ...prev, [row.student]: null }))
      } catch {
        setPrepareStatus(prev => ({ ...prev, [row.student]: 'error' }))
      }
    })

    setPreparing(false)
  }

  const handleDownload = () => {
    if (!rows?.length) return
    const bytes = safeTotalsCsvBytes(rows)
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
          <button className={styles.btnSecondary} onClick={handlePrepareAll} disabled={preparing}>
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
          prepareStatus={prepareStatus}
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
