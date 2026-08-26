import { useState, useEffect } from 'react'
import { useCalendarData } from '../hooks/useCalendarData.js'
import { EditableTable } from './EditableTable.jsx'
import { resolveRowPrices, computeLessonAmount } from '../lib/rowPricing.js'
import { safeTotalsCsvBytes } from '../lib/csvExport.js'
import { getStoredOverride, isValidAmount, isLinkUsable, hasFullName } from '../lib/payments.js'
import { requestPaymentLink } from '../lib/paymentLinkClient.js'
import styles from './CalculatorPage.module.css'

const PREPARE_CONCURRENCY = 6

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

export function CalculatorPage({ getAccessToken, config, customPrices, onCustomPriceChange, onStudentsChange, customerDetails, onCustomerDetailChange, defaultMessage, amountOverrides, onAmountOverrideChange, paymentLinks, onPaymentLinkChange }) {
  const [month, setMonth] = useState(currentMonth)
  const { rows, summary, loading, error, calculate } = useCalendarData(getAccessToken, {
    ...config,
    custom_prices: customPrices,
  })
  const [preparing, setPreparing] = useState(false)
  const [prepareStatus, setPrepareStatus] = useState({})

  useEffect(() => {
    if (rows) onStudentsChange?.(rows.map(r => r.student))
  }, [rows, onStudentsChange])

  const handleRun = () => calculate(month)

  const rowAmount = (row) => {
    const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, customPrices?.[row.student])
    const computed = computeLessonAmount(row, prices)
    return getStoredOverride(amountOverrides, summary?.month, row.student) ?? computed
  }

  const handlePrepareAll = async () => {
    if (!rows?.length || !summary || preparing) return
    const eligible = rows
      .map(row => ({
        row,
        phone: customerDetails?.[row.student]?.phone,
        name: customerDetails?.[row.student]?.full_name || row.student,
        amount: rowAmount(row),
      }))
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

    await runWithConcurrency(eligible, PREPARE_CONCURRENCY, async ({ row, phone, name, amount }) => {
      try {
        const link = await requestPaymentLink(getAccessToken, { studentName: name, phone, amount, month: summary.month })
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
          onChange={e => setMonth(e.target.value)}
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
          <span className={styles.total}>Total: ₪{summary.total_amount_due}</span>
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
        />
      )}

      {rows?.length === 0 && !loading && (
        <div className={styles.empty}>No lessons found for {month}.</div>
      )}
    </div>
  )
}
