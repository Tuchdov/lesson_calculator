import { useState, useEffect } from 'react'
import { useCalendarData } from '../hooks/useCalendarData.js'
import { useBilling } from '../hooks/useBilling.js'
import { EditableTable } from './EditableTable.jsx'
import { resolveRowPrices, computeLessonAmount } from '../lib/rowPricing.js'
import { safeBillingCsvBytes, safeTotalsCsvBytes } from '../lib/csvExport.js'
import { getStoredOverride, hasFullName } from '../lib/payments.js'
import { billingStatus, formatMoney, normalizeAlias, toAgorot } from '../lib/billing.js'
import { billingRequest, paymentInput } from '../lib/billingClient.js'
import { requestPaymentLinks } from '../lib/paymentLinkClient.js'
import styles from './CalculatorPage.module.css'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function CalculatorPage({ userEmail, getAccessToken, config, customPrices, onCustomPriceChange, onStudentsChange, customerDetails, onCustomerDetailChange, defaultMessage, amountOverrides, onAmountOverrideChange }) {
  const [month, setMonth] = useState(currentMonth)
  const { rows, summary, loading, error, calculate } = useCalendarData(getAccessToken, { ...config, custom_prices: customPrices })
  const shownMonth = summary?.month ?? month
  const billing = useBilling(getAccessToken, userEmail, shownMonth)
  const [preparing, setPreparing] = useState(false)
  const [prepareStatus, setPrepareStatus] = useState({})
  const [actionError, setActionError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (rows) onStudentsChange?.(rows.map(r => r.student))
  }, [rows, onStudentsChange])

  const findStudent = name => billing.data?.students.find(s => s.aliases.includes(normalizeAlias(name)))
  const rowAmount = row => {
    if (row.billing_only) return (row.billingStudent?.currentAgorot ?? 0) / 100
    const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, customPrices?.[row.student])
    return getStoredOverride(amountOverrides, shownMonth, row.student) ?? computeLessonAmount(row, prices)
  }
  const tableRows = (rows ?? []).map(row => ({ ...row, billingStudent: findStudent(row.student) }))
  for (const student of billing.data?.students ?? []) {
    if (!tableRows.some(r => r.billingStudent?.id === student.id) && (student.invoices.length || student.legacy.length) && (student.remainingAgorot || student.currentVersion || student.pending.length || student.hold || student.request)) {
      tableRows.push({ student: student.name, student_type: 'non_regular', lessons_60: 0, lessons_45: 0, lessons_30: 0, billing_only: true, billingStudent: student })
    }
  }
  const saved = row => {
    const student = row.billingStudent
    return !!student && (student.currentVersion !== null ? student.currentAgorot === Math.round(rowAmount(row) * 100) : row.billing_only)
  }
  const aliasesConflict = tableRows.some((row, index) => row.billingStudent && tableRows.some((other, j) => j !== index && row.billingStudent.id === other.billingStudent?.id))
  const canCollect = row => !aliasesConflict && saved(row) && billing.data?.mode === 'live' && !billing.data.recovery && !billing.loading && !row.billingStudent.hold && !row.billingStudent.pending.length && row.billingStudent.remainingAgorot > 0

  const prepare = async (student, details) => {
    setActionError(null)
    try {
      const input = await paymentInput(userEmail, student, shownMonth, details)
      const result = await billingRequest(getAccessToken, '/api/create-payment-link', input, { owner: userEmail })
      if (result.state !== 'ready' || !result.link) throw new Error('The payment request is unresolved. Review it in Grow before preparing another.')
    } finally { await billing.refresh() }
  }
  const handleSaveMonth = async () => {
    if (!rows?.length || saving || preparing || billing.loading || !billing.data) return
    setSaving(true)
    setActionError(null)
    try {
      const entries = rows.map(row => {
        const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, customPrices?.[row.student])
        const override = getStoredOverride(amountOverrides, shownMonth, row.student)
        return {
          student: row.student, chargeAgorot: toAgorot(rowAmount(row)), version: findStudent(row.student)?.currentVersion ?? null,
          calculation: { lessons: Object.fromEntries(['60', '45', '30'].map(d => [d, row[`lessons_${d}`]])), prices: Object.fromEntries(['60', '45', '30'].map(d => [d, toAgorot(prices[d])])), overrideAgorot: override == null ? null : toAgorot(override) },
        }
      })
      await billing.action('saveMonth', { entries })
    } catch (err) { setActionError(err.message) } finally { setSaving(false) }
  }
  const handlePrepareAll = async () => {
    if (preparing || saving) return
    const eligible = tableRows.filter(row => {
      const details = customerDetails?.[row.student]
      return canCollect(row) && details?.phone && hasFullName(details.full_name || row.student) && !row.billingStudent.request
    })
    if (!eligible.length) return
    setPreparing(true)
    setActionError(null)
    setPrepareStatus(Object.fromEntries(eligible.map(row => [row.student, 'loading'])))
    try {
      for (let offset = 0; offset < eligible.length; offset += 40) {
        const batch = eligible.slice(offset, offset + 40)
        const inputs = await Promise.all(batch.map(row => paymentInput(userEmail, row.billingStudent, shownMonth, customerDetails[row.student])))
        const results = await requestPaymentLinks(getAccessToken, inputs, userEmail)
        setPrepareStatus(previous => ({ ...previous, ...Object.fromEntries(batch.map((row, i) => [row.student, results[i].state === 'ready' ? null : 'error'])) }))
      }
    } catch (err) {
      setActionError(err.message)
      setPrepareStatus(previous => Object.fromEntries(Object.entries(previous).map(([name, state]) => [name, state === 'loading' ? 'error' : state])))
    } finally { await billing.refresh(); setPreparing(false) }
  }
  const exportSavedBalances = !!billing.data && !billing.loading && !aliasesConflict && tableRows.every(saved)
  const handleDownload = () => {
    const exportRows = tableRows.map(row => {
      const student = row.billingStudent
      return { ...row, current_charge: student?.currentAgorot / 100, prior_balance: student?.priorAgorot / 100, paid: student?.paidAgorot / 100, amount_due: student?.remainingAgorot / 100, payment_status: billingStatus(student) }
    })
    const bytes = exportSavedBalances ? safeBillingCsvBytes(exportRows) : safeTotalsCsvBytes((rows ?? []).map(row => ({ ...row, amount_due: rowAmount(row) })))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportSavedBalances ? 'lessons' : 'lesson-estimate'}-${shownMonth}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  const currentChargesSaved = !!rows?.length && tableRows.every(saved)
  const total = (billing.data?.students ?? []).reduce((n, student) => n + student.remainingAgorot, 0)
  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Lesson Calculator</h2>
      <div className={styles.controls}>
        <input aria-label="Billing month" type="month" className={styles.monthInput} value={month} onChange={e => setMonth(e.target.value)} />
        <button className={styles.btnPrimary} onClick={() => { setActionError(null); calculate(month) }} disabled={loading || preparing || saving}>{loading ? 'Loading…' : 'Calculate'}</button>
        {rows?.length > 0 && <button className={styles.btnSecondary} onClick={handleSaveMonth} disabled={saving || preparing || billing.loading || !billing.data}>{saving ? 'Saving…' : currentChargesSaved ? 'Month saved' : 'Save month'}</button>}
        <button className={styles.btnSecondary} onClick={billing.refresh} disabled={billing.loading}>Refresh payments</button>
        {tableRows.length > 0 && <button className={styles.btnSecondary} onClick={handleDownload} title={exportSavedBalances ? 'Export saved balances and payment status' : 'Export calculated lessons only; payment status and earlier balances are excluded'} disabled={!exportSavedBalances && !rows?.length}>Download CSV</button>}
        {tableRows.length > 0 && <button className={styles.btnSecondary} onClick={handlePrepareAll} disabled={preparing || saving || !tableRows.some(canCollect)}>{preparing ? 'Preparing links…' : 'Prepare all links'}</button>}
      </div>
      {(error || actionError || billing.error) && <div className={styles.error} role="alert">{error || actionError || billing.error}</div>}
      {aliasesConflict && <p role="alert">Multiple calendar names map to the same student. Consolidate their lesson charges before collecting or exporting.</p>}
      {!billing.data && <p>Payment status is unavailable until Billing is configured and loaded. Link creation is disabled.</p>}
      {!!rows?.length && !exportSavedBalances && <p>CSV exports the calculated lesson estimate. Saved balances and payment status are included once the month is saved and billing is available.</p>}
      {billing.data && (billing.data.mode !== 'live' || billing.data.recovery) && <p role="status">Billing is in {billing.data.recovery ? 'recovery' : 'preview'} mode. Records can be reviewed; collection is disabled.</p>}
      {!!billing.data?.unmatchedReports && <p role="status">{billing.data.unmatchedReports} Grow notifications are awaiting a matching link result. Recover the result from Make before reconciling these reports.</p>}
      {!!billing.data?.integrationNotices?.length && <details><summary>Payment integration needs review ({billing.data.integrationNotices.length})</summary>
        {billing.data.integrationNotices.map(notice => <div key={notice.id}><p>{notice.operation} for Grow transaction {notice.transactionId}: {notice.error}</p>
          {notice.operation === 'approve' && <form onSubmit={async event => {
            event.preventDefault()
            const form = event.currentTarget
            const evidence = String(new FormData(form).get('evidence'))
            setSaving(true)
            try { await billing.action('resolveApproval', { jobId: notice.id, evidence }); form.reset() } catch (err) { setActionError(err.message) } finally { setSaving(false) }
          }}><label>Successful acknowledgement checked in Make <input name="evidence" required minLength={5} maxLength={1000} /></label><button disabled={saving}>Record checked acknowledgement</button></form>}
        </div>)}
      </details>}
      {rows?.length > 0 && !currentChargesSaved && <p>Save this month to start tracking its charges. Earlier history counts only if you explicitly record an opening balance. Changes to saved charges require an adjustment under Manage payments.</p>}
      {billing.data && <div className={styles.summaryBar}><span>{shownMonth}</span><span>{tableRows.length} students</span><span className={styles.total}>Saved outstanding: ₪{formatMoney(total)}</span></div>}
      {tableRows.length > 0 && <EditableTable key={shownMonth} rows={tableRows} config={config} customPrices={customPrices} onCustomPriceChange={onCustomPriceChange} customerDetails={customerDetails} onCustomerDetailChange={onCustomerDetailChange} month={shownMonth} defaultMessage={defaultMessage} amountOverrides={amountOverrides} onAmountOverrideChange={onAmountOverrideChange} billing={{ ...billing, prepare, aliasesConflict }} prepareStatus={prepareStatus} />}
      {rows?.length === 0 && !loading && <div className={styles.empty}>No lessons found for {shownMonth}. Any saved outstanding balances are shown above.</div>}
    </div>
  )
}
