import { useState } from 'react'
import { formatMoney, toAgorot } from '../lib/billing.js'
import styles from './BillingActions.module.css'

export function BillingActions({ student, billing, previewCharge }) {
  const [form, setForm] = useState(null)
  const [amount, setAmount] = useState('')
  const [evidence, setEvidence] = useState('')
  const [alias, setAlias] = useState('')
  const [source, setSource] = useState('bank')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const open = (action, extra = {}, amountAgorot = student.remainingAgorot) => {
    setForm({ action, actionId: crypto.randomUUID(), ...extra })
    setAmount(formatMoney(amountAgorot))
    setEvidence('')
    setError(null)
  }
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const input = { ...form, studentId: student.id, revision: student.revision, evidence }
      if (form.action === 'recordManual' || form.action === 'reversePayment' || form.action === 'openingBalance') input.amountAgorot = toAgorot(amount)
      if (form.action === 'recordManual') input.source = source
      if (form.action === 'adjustInvoice') input.chargeAgorot = toAgorot(amount)
      if (form.action === 'addAlias') input.alias = alias
      await billing.action(form.action, input)
      setForm(null)
    } catch (err) {
      setError(err.message)
      await billing.refresh()
    } finally { setBusy(false) }
  }
  const currentInvoice = student.invoices.find(i => i.month === billing.data.month)
  return (
    <details className={styles.actions}>
      <summary>Manage payments</summary>
      {student.hold && <p role="status">{student.hold}</p>}
      {student.legacy.map(link => <p key={link.id}>Historical link ({link.month}): ₪{formatMoney(link.amountAgorot)}.
        <button type="button" disabled={!!form} onClick={() => open('resolveLegacy', { legacyId: link.id, providerClosed: true })}>Record paid / closed status checked in Grow</button>
      </p>)}
      {student.pending.map(report => (
        <p key={report.id}>
          Grow transaction {report.transactionId}: ₪{formatMoney(report.amountAgorot)}
          {report.statusCode === '2' && report.supported !== false ? <button type="button" disabled={!!form} onClick={() => open('confirmEvent', { eventId: report.id })}>Confirm after checking Grow</button> : <span> — unsupported payment flow; review in Grow.</span>}
          <button type="button" disabled={!!form} onClick={() => open('resolveEvent', { eventId: report.id })}>Record report reconciled without posting</button>
        </p>
      ))}
      {student.request && <p>Link: {student.request.state}{!student.request.reusable && ' — resolve before preparing another'}.
        {!!student.request.processIds?.length && ` Grow processes: ${student.request.processIds.join(', ')}.`}
        <button type="button" disabled={!!form} onClick={() => open('closeRequest', { requestId: student.request.id, providerClosed: true, dispatchSettled: true })}>Record closure checked in Grow</button>
      </p>}
      {student.reviewRequests?.map(request => <p key={request.id}>Unexpected link result: {request.processIds.join(', ')}.
        <button type="button" disabled={!!form} onClick={() => open('closeRequest', { requestId: request.id, providerClosed: true, dispatchSettled: true })}>Record unexpected link closure checked in Grow</button>
      </p>)}
      <button type="button" disabled={!!form} onClick={() => open('recordManual')}>Record cash / bank payment</button>
      {!student.invoices.some(i => i.month === '0001-01') && <button type="button" disabled={!!form} onClick={() => open('openingBalance', {}, 0)}>Record reviewed opening balance</button>}
      {currentInvoice && <button type="button" disabled={!!form} onClick={() => open('adjustInvoice', { invoiceId: currentInvoice.id }, previewCharge)}>Adjust saved charge</button>}
      {student.invoices.filter(i => i.month === '0001-01').map(invoice => <button key={invoice.id} type="button" disabled={!!form} onClick={() => open('adjustInvoice', { invoiceId: invoice.id }, invoice.chargeAgorot)}>Adjust opening balance</button>)}
      <button type="button" disabled={!!form} onClick={() => open('addAlias')}>Add renamed calendar name</button>
      {student.payments.filter(p => p.netAgorot > 0).map(payment => <p key={payment.id}>
        {payment.source} payment: ₪{formatMoney(payment.netAgorot)}{payment.creditAgorot > 0 && ` (₪${formatMoney(payment.creditAgorot)} unapplied)`}
        <button type="button" disabled={!!form} onClick={() => open('reversePayment', { paymentId: payment.id }, payment.netAgorot)}>Record verified refund / correction</button>
      </p>)}
      {form && <form onSubmit={submit}>
        <p>{({ confirmEvent: 'Check the transaction ID, amount, and final paid status in Grow, then record your evidence.', resolveEvent: 'Use only after checking Grow. This dismisses the report without changing balances. Record any real payment or refund separately first.', closeRequest: 'Confirm the Make execution is finished with no further creation retries, the link is closed in Grow, and no payment is in progress. Record evidence of all three checks.', resolveLegacy: 'Check this historical link is paid or closed in Grow. This clears its collection hold; it does not create debt or record a payment.', reversePayment: 'This records a refund already made or a correction. It does not send money.', openingBalance: 'Enter only debt you have checked from before your first saved month. Existing links do not establish unpaid debt.' })[form.action]}</p>
        {['recordManual', 'reversePayment', 'adjustInvoice', 'openingBalance'].includes(form.action) && <label>Amount (₪) <input type="number" min="0" step="0.01" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} required /></label>}
        {form.action === 'recordManual' && <label>Payment source <select value={source} disabled={busy} onChange={e => setSource(e.target.value)}><option value="bank">Bank transfer</option><option value="cash">Cash</option></select></label>}
        {form.action === 'addAlias' ? <label>New calendar name <input value={alias} disabled={busy} onChange={e => setAlias(e.target.value)} required /></label> : <label>Evidence / reason <input value={evidence} minLength={5} maxLength={1000} disabled={busy} onChange={e => setEvidence(e.target.value)} required /></label>}
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save checked record'}</button>
        <button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
        {error && <p role="alert">{error} Check the refreshed records before retrying.</p>}
      </form>}
    </details>
  )
}
