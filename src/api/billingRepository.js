import { transaction, query, one } from './db.js'
import { ServiceError } from './serviceError.js'
import { normalizeAlias, validateMonth } from '../lib/billing.js'
import { scheduleResolvedPayloads } from './payloadRetention.js'

export const id = () => crypto.randomUUID().replaceAll('-', '')
export const fail = (message, status = 409) => { throw new ServiceError(status, message) }
export function requireId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) fail('Invalid request identifier.', 400)
  return value
}
export function requireMoney(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 100_000_000) fail('Invalid amount.', 400)
  return value
}
function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('Invalid billing revision. Refresh before continuing.', 400)
}
export function requireEvidence(value) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.length > 1000) fail('Record how this was checked in Grow or your payment records.', 400)
  return value.trim()
}
function calculationSnapshot(entry) {
  if (!entry.calculation) return { student: normalizeAlias(entry.student), chargeAgorot: entry.chargeAgorot }
  const { lessons, prices, overrideAgorot } = entry.calculation
  const snapshot = { student: normalizeAlias(entry.student), chargeAgorot: entry.chargeAgorot, lessons: {}, prices: {}, overrideAgorot: overrideAgorot ?? null }
  for (const duration of ['60', '45', '30']) {
    if (!Number.isSafeInteger(lessons?.[duration]) || lessons[duration] < 0 || lessons[duration] > 1000) fail('Invalid lesson count.', 400)
    requireMoney(prices?.[duration], true)
    snapshot.lessons[duration] = lessons[duration]
    snapshot.prices[duration] = prices[duration]
  }
  if (overrideAgorot != null) requireMoney(overrideAgorot, true)
  const calculated = ['60', '45', '30'].reduce((n, duration) => n + lessons[duration] * prices[duration], 0)
  if ((overrideAgorot ?? calculated) !== entry.chargeAgorot) fail('Invoice calculation does not match the saved charge.', 400)
  return snapshot
}
function monthKey(month) {
  if (!validateMonth(month)) fail('Invalid billing month.', 400)
  return month
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}

export function createBillingRepository(db, { environment, merchant, mode = 'shadow', now = Date.now }) {
  if (!['sandbox', 'production'].includes(environment) || !merchant) fail('Configure the billing environment and merchant.', 503)
  const scope = ['grow', environment, merchant]
  const financialIdentity = transactionId => JSON.stringify([...scope, transactionId])
  async function student(tx, owner, studentId, revision) {
    const row = await one(tx, 'SELECT * FROM students WHERE owner_id=? AND id=?', [owner, studentId])
    if (!row) fail('Student not found.', 404)
    if (revision !== undefined && revision !== row.revision) fail('Billing changed. Refresh before continuing.')
    return row
  }
  async function updateRevision(tx, studentId) {
    await tx.execute({ sql: 'UPDATE students SET revision=revision+1 WHERE id=?', args: [studentId] })
  }
  async function refreshHold(tx, studentId) {
    const pending = await one(tx, `SELECT e.id FROM payment_events e JOIN payment_requests r ON r.id=e.request_id
      WHERE r.student_id=? AND e.state NOT IN ('confirmed','dismissed') LIMIT 1`, [studentId])
    const credit = await one(tx, 'SELECT id FROM payment_balances WHERE student_id=? AND net_agorot>allocated_agorot LIMIT 1', [studentId])
    const conflict = await one(tx, "SELECT id FROM payment_requests WHERE student_id=? AND state='needs_review' LIMIT 1", [studentId])
    const legacy = await one(tx, 'SELECT id FROM legacy_links WHERE student_id=? AND reviewed=0 LIMIT 1', [studentId])
    await tx.execute({ sql: 'UPDATE students SET hold=? WHERE id=?', args: [pending ? 'Payment reported — check Grow before collecting again.' : credit ? 'Unapplied payment credit — review before collecting again.' : conflict ? 'Conflicting link results — review in Grow.' : legacy ? 'Historical payment link — check its payment/closure status in Grow.' : null, studentId] })
  }
  async function aliasMap(tx, owner) {
    const rows = await query(tx, 'SELECT s.*,a.alias FROM students s JOIN student_aliases a ON a.student_id=s.id WHERE a.owner_id=?', [owner])
    return new Map(rows.map(row => [row.alias, row]))
  }
  function importedStudent(owner, name, aliases, statements) {
    if (!name || name.length > 160) fail('Invalid student name.', 400)
    if (aliases.has(name)) return aliases.get(name)
    const row = { id: id(), display_name: name, revision: 0 }
    statements.push({ sql: 'INSERT INTO students(id,owner_id,display_name) VALUES(?,?,?)', args: [row.id, owner, name] })
    statements.push({ sql: 'INSERT INTO student_aliases(owner_id,alias,student_id) VALUES(?,?,?)', args: [owner, name, row.id] })
    aliases.set(name, row)
    return row
  }
  async function outstanding(tx, owner, studentId, month) {
    return query(tx, `SELECT *, total_agorot-paid_agorot AS outstanding FROM invoice_balances
      WHERE owner_id=? AND student_id=? AND month<=? AND total_agorot>paid_agorot ORDER BY month,id`, [owner, studentId, month])
  }
  async function allocate(tx, payment, invoices) {
    let remaining = payment.amount_agorot
    const balances = await query(tx, 'SELECT id,total_agorot-paid_agorot AS outstanding FROM invoice_balances WHERE owner_id=? AND student_id=?', [payment.owner_id, payment.student_id])
    const statements = []
    for (const invoice of invoices) {
      const current = balances.find(b => b.id === invoice.id)
      if (!current) fail('Invoice allocation target not found.')
      const amount = Math.min(remaining, current.outstanding, invoice.cap ?? Infinity)
      if (amount > 0) {
        statements.push({ sql: 'INSERT INTO payment_allocations(id,owner_id,student_id,payment_id,invoice_id,agorot) VALUES(?,?,?,?,?,?)', args: [id(), payment.owner_id, payment.student_id, payment.id, invoice.id, amount] })
        remaining -= amount
      }
    }
    if (statements.length) await tx.batch(statements)
  }
  async function reverseAllocations(tx, owner, studentId, paymentId, amount) {
    const allocations = await query(tx, `SELECT a.*, a.agorot + COALESCE((SELECT SUM(r.agorot) FROM payment_allocations r WHERE r.reverses_id=a.id),0) AS available
      FROM payment_allocations a JOIN invoices i ON i.id=a.invoice_id WHERE a.payment_id=? AND a.agorot>0 ORDER BY i.month DESC,a.rowid DESC`, [paymentId])
    const statements = []
    for (const allocation of allocations) {
      const take = Math.min(amount, allocation.available)
      if (take > 0) {
        statements.push({ sql: 'INSERT INTO payment_allocations(id,owner_id,student_id,payment_id,invoice_id,agorot,reverses_id) VALUES(?,?,?,?,?,?,?)', args: [id(), owner, studentId, paymentId, allocation.invoice_id, -take, allocation.id] })
        amount -= take
      }
    }
    if (amount !== 0) fail('Allocation reversal could not be reconciled.')
    if (statements.length) await tx.batch(statements)
  }

  async function getBilling(owner, month) {
    monthKey(month)
    return transaction(db, async tx => {
      const students = await query(tx, 'SELECT * FROM students WHERE owner_id=? ORDER BY display_name', [owner])
      const invoices = await query(tx, 'SELECT * FROM invoice_balances WHERE owner_id=? AND month<=? ORDER BY month,id', [owner, month])
      const aliases = await query(tx, 'SELECT * FROM student_aliases WHERE owner_id=?', [owner])
      const legacy = await query(tx, 'SELECT id,student_id,month,amount_agorot FROM legacy_links WHERE owner_id=? AND reviewed=0', [owner])
      const requests = await query(tx, "SELECT * FROM payment_requests WHERE owner_id=? AND (holds_slot=1 OR state='needs_review')", [owner])
      const pending = await query(tx, `SELECT e.id,e.transaction_id,e.amount_agorot,e.status_code,e.state,e.supported,r.student_id
        FROM payment_events e JOIN payment_requests r ON r.id=e.request_id WHERE r.owner_id=? AND e.state NOT IN ('confirmed','dismissed')`, [owner])
      const payments = await query(tx, 'SELECT * FROM payment_balances WHERE owner_id=? ORDER BY created_at DESC,id', [owner])
      const notices = await query(tx, `SELECT j.id,j.operation,j.state,j.error,e.transaction_id FROM integration_jobs j
        JOIN payment_events e ON e.id=j.event_id JOIN payment_requests r ON r.id=e.request_id
        WHERE r.owner_id=? AND j.state='needs_review' ORDER BY j.rowid DESC LIMIT 50`, [owner])
      const unmatched = await one(tx, 'SELECT COUNT(*) AS n FROM payment_events WHERE environment=? AND merchant=? AND request_id IS NULL', [environment, merchant])
      const control = await one(tx, 'SELECT * FROM billing_control WHERE id=1')
      return {
        mode, recovery: control?.mode !== 'normal' || mode === 'recovery', month, currency: 'ILS',
        capabilities: { automaticVerification: false, recoverByRequestId: false, deactivateLink: false },
        integrationNotices: notices.map(j => ({ id: j.id, operation: j.operation, transactionId: j.transaction_id, error: j.error })),
        unmatchedReports: unmatched.n,
        students: students.map(s => {
          const bills = invoices.filter(i => i.student_id === s.id)
          const current = bills.find(i => i.month === month)
          const priorAgorot = bills.filter(i => i.month < month).reduce((n, i) => n + i.total_agorot - i.paid_agorot, 0)
          const request = requests.find(r => r.student_id === s.id && r.holds_slot === 1)
          const processIds = r => [r.process_id, r.conflict_result ? JSON.parse(r.conflict_result).processId : null].filter(Boolean)
          const reusable = request?.state === 'ready' && request.revision === s.revision && request.month === month && !s.hold
          return {
            id: s.id, name: s.display_name, revision: s.revision, hold: s.hold,
            aliases: aliases.filter(a => a.student_id === s.id).map(a => a.alias),
            legacy: legacy.filter(l => l.student_id === s.id).map(l => ({ id: l.id, month: l.month, amountAgorot: l.amount_agorot })),
            invoices: bills.map(i => ({ id: i.id, month: i.month, chargeAgorot: i.total_agorot, paidAgorot: i.paid_agorot, version: i.version })),
            currentAgorot: current?.total_agorot ?? 0, currentVersion: current?.version ?? null,
            paidAgorot: bills.reduce((n, i) => n + i.paid_agorot, 0), priorAgorot,
            remainingAgorot: priorAgorot + (current ? current.total_agorot - current.paid_agorot : 0),
            pending: pending.filter(e => e.student_id === s.id).map(e => ({ id: e.id, transactionId: e.transaction_id, amountAgorot: e.amount_agorot, statusCode: e.status_code, state: e.state, supported: !!e.supported })),
            payments: payments.filter(p => p.student_id === s.id).map(p => ({ id: p.id, source: p.source, amountAgorot: p.amount_agorot, netAgorot: p.net_agorot, creditAgorot: p.net_agorot - p.allocated_agorot })),
            reviewRequests: requests.filter(r => r.student_id === s.id && r.state === 'needs_review' && !r.holds_slot).map(r => ({ id: r.id, processIds: processIds(r) })),
            request: request ? { id: request.id, requestId: request.request_id, state: request.state, reusable, amountAgorot: request.amount_agorot, link: reusable ? request.url : null, processIds: processIds(request) } : null,
          }
        }),
      }
    }, 'read')
  }

  async function saveMonth(owner, { month, entries }) {
    monthKey(month)
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) fail('Provide 1–100 invoice entries.', 400)
    const names = entries.map(e => normalizeAlias(e?.student))
    if (new Set(names).size !== names.length) fail('Duplicate student entries.', 400)
    await transaction(db, async tx => {
      const aliases = await aliasMap(tx, owner)
      const previousInvoices = await query(tx, 'SELECT * FROM invoice_balances WHERE owner_id=? AND month=?', [owner, month])
      const statements = []
      const seen = new Set()
      for (const entry of entries) {
        requireMoney(entry.chargeAgorot, true)
        const name = normalizeAlias(entry.student)
        const s = importedStudent(owner, name, aliases, statements)
        if (seen.has(s.id)) fail('Multiple calendar names refer to one student. Consolidate their charges before saving.')
        seen.add(s.id)
        const previous = previousInvoices.find(i => i.student_id === s.id)
        if (previous) {
          if (previous.version !== entry.version || previous.total_agorot !== entry.chargeAgorot) fail('An issued invoice changed. Refresh or record an explicit adjustment.')
          continue
        }
        if (entry.version != null) fail('Invoice version does not exist.')
        const snapshot = JSON.stringify(calculationSnapshot(entry))
        statements.push({ sql: 'INSERT INTO invoices(id,owner_id,student_id,month,charge_agorot,snapshot) VALUES(?,?,?,?,?,?)', args: [id(), owner, s.id, month, entry.chargeAgorot, snapshot] })
        statements.push({ sql: 'UPDATE students SET revision=revision+1 WHERE id=?', args: [s.id] })
      }
      // One SQL batch avoids hundreds of remote round trips within a short libSQL transaction.
      if (statements.length) await tx.batch(statements)
    })
    return getBilling(owner, month)
  }

  async function claimRequest(owner, input) {
    requireId(input.requestId)
    monthKey(input.month)
    const payloadHash = await digest([input.studentId, input.month, input.revision, input.studentName, input.phone])
    return transaction(db, async tx => {
      const control = await one(tx, 'SELECT mode FROM billing_control WHERE id=1')
      if (mode !== 'live' || control?.mode !== 'normal') fail('Collection is disabled until billing setup/recovery is complete.', 503)
      const s = await student(tx, owner, input.studentId)
      const previous = await one(tx, 'SELECT * FROM payment_requests WHERE owner_id=? AND request_id=?', [owner, input.requestId])
      if (previous) {
        if (previous.payload_hash !== payloadHash) fail('This request ID belongs to different payment details.')
        if (previous.state === 'ready' && (previous.revision !== s.revision || s.hold)) fail('This link is stale. Review its status in Grow before replacing it.')
        return { ...previous, dispatch: false }
      }
      if (s.revision !== input.revision) fail('Billing changed. Refresh before preparing a link.')
      if (s.hold) fail(s.hold)
      const active = await one(tx, 'SELECT id FROM payment_requests WHERE owner_id=? AND student_id=? AND holds_slot=1', [owner, s.id])
      if (active) fail('Resolve the existing payment link in Grow before preparing another.')
      const bills = await outstanding(tx, owner, s.id, input.month)
      const amount = bills.reduce((n, b) => n + b.outstanding, 0)
      requireMoney(amount)
      const request = { id: id(), owner_id: owner, student_id: s.id, request_id: input.requestId, revision: s.revision, amount_agorot: amount, month: input.month, state: 'dispatching', snapshot: JSON.stringify(bills.map(i => [i.id, i.version, i.outstanding])), environment, merchant, dispatch: true }
      await tx.execute({ sql: 'INSERT INTO payment_requests(id,owner_id,student_id,request_id,payload_hash,snapshot,revision,amount_agorot,month,state,environment,merchant) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', args: [request.id, owner, s.id, input.requestId, payloadHash, request.snapshot, s.revision, amount, input.month, request.state, environment, merchant] })
      for (const bill of bills) await tx.execute({ sql: 'INSERT INTO request_items(request_id,owner_id,student_id,invoice_id,agorot,invoice_version) VALUES(?,?,?,?,?,?)', args: [request.id, owner, s.id, bill.id, bill.outstanding, bill.version] })
      return request
    })
  }

  async function completeRequest(requestId, { link, processId, processToken, amountAgorot }) {
    requireId(requestId)
    if (typeof link !== 'string' || !link.startsWith('https://') || typeof processId !== 'string' || !/^[\w-]{1,100}$/.test(processId) || typeof processToken !== 'string' || !processToken || processToken.length > 300) fail('Invalid payment result.', 400)
    try { new URL(link) } catch { fail('Invalid payment link URL.', 400) }
    return transaction(db, async tx => {
      const r = await one(tx, 'SELECT * FROM payment_requests WHERE id=? AND environment=? AND merchant=?', [requestId, environment, merchant])
      if (!r) fail('Payment request not found.', 404)
      if (amountAgorot !== r.amount_agorot) fail('Payment result amount does not match.')
      if (r.process_id && (r.process_id !== processId || r.url !== link || r.process_token !== processToken)) {
        await tx.execute({ sql: "UPDATE payment_requests SET state='needs_review',conflict_result=? WHERE id=?", args: [JSON.stringify({ link, processId, processToken, amountAgorot }), r.id] })
        await refreshHold(tx, r.student_id)
        return { state: 'needs_review' }
      }
      // A late completion must never reopen a cancelled/completed request.
      const unexpectedLateLink = !r.process_id && ['cancelled', 'completed'].includes(r.state)
      const state = unexpectedLateLink ? 'needs_review' : ['cancelled', 'completed', 'needs_review'].includes(r.state) ? r.state : 'ready'
      await tx.execute({ sql: 'UPDATE payment_requests SET url=?,process_id=?,process_token=?,state=? WHERE id=?', args: [link, processId, processToken, state, r.id] })
      const unmatched = await query(tx, "SELECT * FROM payment_events WHERE environment=? AND merchant=? AND process_id=? AND request_id IS NULL AND forwarding_authenticated=1", [environment, merchant, processId])
      for (const event of unmatched) {
        await tx.execute({ sql: "UPDATE payment_events SET request_id=?,state='reported' WHERE id=?", args: [r.id, event.id] })
        await tx.execute({ sql: "INSERT INTO integration_jobs(id,operation,event_id) VALUES(?,'verify',?) ON CONFLICT(operation,event_id) DO UPDATE SET state='pending',error=NULL", args: [id(), event.id] })
      }
      await refreshHold(tx, r.student_id)
      return { state }
    })
  }
  async function unknownRequest(requestId) {
    await db.execute({ sql: "UPDATE payment_requests SET state='unknown' WHERE id=? AND state='dispatching'", args: [requestId] })
  }

  async function recordManual(owner, input) {
    requireRevision(input.revision)
    requireId(input.actionId)
    requireMoney(input.amountAgorot)
    const evidence = requireEvidence(input.evidence)
    if (!['cash', 'bank'].includes(input.source)) fail('Choose cash or bank transfer. Confirm Grow reports separately.', 400)
    monthKey(input.month)
    const detailsHash = await digest([input.studentId, input.source, input.month, input.amountAgorot, evidence])
    await transaction(db, async tx => {
      const previous = await one(tx, 'SELECT * FROM payments WHERE owner_id=? AND identity=?', [owner, input.actionId])
      if (previous) {
        if (previous.details_hash !== detailsHash) fail('Payment action ID was reused with different details.')
        return
      }
      await student(tx, owner, input.studentId, input.revision)
      const payment = { id: id(), owner_id: owner, student_id: input.studentId, amount_agorot: input.amountAgorot }
      await tx.execute({ sql: 'INSERT INTO payments(id,owner_id,student_id,source,identity,amount_agorot,evidence,details_hash) VALUES(?,?,?,?,?,?,?,?)', args: [payment.id, owner, input.studentId, input.source, input.actionId, input.amountAgorot, evidence, detailsHash] })
      await allocate(tx, payment, await outstanding(tx, owner, input.studentId, input.month))
      await updateRevision(tx, input.studentId)
      await refreshHold(tx, input.studentId)
    })
    return getBilling(owner, input.month)
  }

  async function confirmEvent(owner, input) {
    monthKey(input.month)
    const evidence = requireEvidence(input.evidence)
    await transaction(db, async tx => {
      const event = await one(tx, `SELECT e.*,r.owner_id,r.student_id,r.amount_agorot AS requested_amount FROM payment_events e JOIN payment_requests r ON r.id=e.request_id
        WHERE e.id=? AND r.owner_id=?`, [input.eventId, owner])
      if (!event) fail('Payment report not found.', 404)
      if (event.status_code !== '2' || !event.supported) fail('This event is not a supported single-payment ILS paid report. Reconcile it in Grow.')
      const identity = financialIdentity(event.transaction_id)
      let payment = await one(tx, "SELECT * FROM payments WHERE owner_id=? AND source='grow' AND identity=?", [owner, identity])
      if (payment && (payment.amount_agorot !== event.amount_agorot || payment.request_id !== event.request_id)) fail('Conflicting reports for the same transaction. Review in Grow.')
      if (!payment) {
        await student(tx, owner, event.student_id)
        payment = { id: id(), owner_id: owner, student_id: event.student_id, amount_agorot: event.amount_agorot }
        await tx.execute({ sql: "INSERT INTO payments(id,owner_id,student_id,source,identity,amount_agorot,evidence,request_id) VALUES(?,?,?,'grow',?,?,?,?)", args: [payment.id, owner, event.student_id, identity, event.amount_agorot, evidence, event.request_id] })
        const items = await query(tx, 'SELECT i.id,r.agorot AS cap FROM request_items r JOIN invoices i ON i.id=r.invoice_id WHERE r.request_id=? ORDER BY i.month,i.id', [event.request_id])
        await allocate(tx, payment, items)
        await updateRevision(tx, event.student_id)
      }
      // Different transport events for one confirmed transaction share one principal.
      await tx.execute({ sql: `UPDATE integration_payloads SET purge_after=NULL WHERE id IN (
        SELECT id FROM payment_events WHERE request_id=? AND transaction_id=? AND amount_agorot=? AND status_code='2' AND supported=1 AND state!='confirmed')`, args: [event.request_id, event.transaction_id, event.amount_agorot] })
      await tx.execute({ sql: "UPDATE payment_events SET state='confirmed',payment_id=? WHERE request_id=? AND transaction_id=? AND amount_agorot=? AND status_code='2' AND supported=1", args: [payment.id, event.request_id, event.transaction_id, event.amount_agorot] })
      await tx.execute({ sql: "UPDATE payment_requests SET state='completed',holds_slot=0,resolution=? WHERE id=? AND state!='needs_review'", args: [evidence, event.request_id] })
      const reports = await query(tx, 'SELECT id FROM payment_events WHERE payment_id=?', [payment.id])
      if (reports.length) await tx.batch(reports.map(report => ({ sql: "UPDATE integration_jobs SET state='done',error=NULL,lease_until=0,generation=generation+1 WHERE operation='verify' AND event_id=?", args: [report.id] })))
      const approval = await one(tx, "SELECT j.id FROM integration_jobs j JOIN payment_events e ON e.id=j.event_id WHERE j.operation='approve' AND e.payment_id=? LIMIT 1", [payment.id])
      if (!approval) await tx.execute({ sql: "INSERT INTO integration_jobs(id,operation,event_id) VALUES(?,'approve',?)", args: [id(), event.id] })
      await scheduleResolvedPayloads(tx, now())
      await refreshHold(tx, event.student_id)
    })
    return getBilling(owner, monthKey(input.month))
  }

  async function closeRequest(owner, input) {
    requireRevision(input.revision)
    monthKey(input.month)
    const evidence = requireEvidence(input.evidence)
    if (input.providerClosed !== true || input.dispatchSettled !== true) fail('Confirm the Make execution has finished and the Grow link is closed with no payment in progress.', 400)
    await transaction(db, async tx => {
      const r = await one(tx, 'SELECT * FROM payment_requests WHERE owner_id=? AND id=?', [owner, input.requestId])
      if (!r) fail('Payment request not found.', 404)
      if (r.state === 'cancelled') {
        if (r.resolution !== evidence) fail('This request was already closed with different evidence.')
        return
      }
      await student(tx, owner, r.student_id, input.revision)
      await tx.execute({ sql: "UPDATE payment_requests SET state='cancelled',holds_slot=0,resolution=? WHERE id=? AND state!='completed'", args: [evidence, r.id] })
      await updateRevision(tx, r.student_id)
      await refreshHold(tx, r.student_id)
    })
    return getBilling(owner, monthKey(input.month))
  }

  async function resolveEvent(owner, input) {
    monthKey(input.month)
    const evidence = requireEvidence(input.evidence)
    await transaction(db, async tx => {
      const event = await one(tx, 'SELECT e.*,r.student_id FROM payment_events e JOIN payment_requests r ON r.id=e.request_id WHERE e.id=? AND r.owner_id=?', [input.eventId, owner])
      if (!event) fail('Payment report not found.', 404)
      if (event.state === 'confirmed') fail('This is a posted payment. Record a verified reversal instead.')
      if (event.state === 'dismissed') {
        const resolution = await one(tx, 'SELECT evidence FROM payment_event_resolutions WHERE event_id=?', [event.id])
        if (resolution?.evidence !== evidence) fail('This report was already resolved with different evidence.')
        return
      }
      await tx.execute({ sql: 'INSERT INTO payment_event_resolutions(event_id,owner_id,evidence) VALUES(?,?,?)', args: [event.id, owner, evidence] })
      await tx.execute({ sql: "UPDATE payment_events SET state='dismissed' WHERE id=?", args: [event.id] })
      await tx.execute({ sql: "UPDATE integration_jobs SET state='done',error=?,generation=generation+1,lease_until=0 WHERE event_id=? AND operation='verify'", args: [evidence, event.id] })
      await tx.execute({ sql: 'UPDATE integration_payloads SET purge_after=? WHERE id=?', args: [now() + 86_400_000, event.id] })
      await updateRevision(tx, event.student_id)
      await refreshHold(tx, event.student_id)
    })
    return getBilling(owner, input.month)
  }

  async function reversePayment(owner, input) {
    requireRevision(input.revision)
    monthKey(input.month)
    requireId(input.actionId)
    requireMoney(input.amountAgorot)
    const reason = requireEvidence(input.evidence)
    await transaction(db, async tx => {
      const previous = await one(tx, 'SELECT * FROM payment_reversals WHERE owner_id=? AND action_id=?', [owner, input.actionId])
      if (previous) {
        if (previous.payment_id !== input.paymentId || previous.agorot !== input.amountAgorot || previous.reason !== reason) fail('Reversal action ID was reused.')
        return
      }
      const payment = await one(tx, 'SELECT * FROM payment_balances WHERE owner_id=? AND id=?', [owner, input.paymentId])
      if (!payment) fail('Payment not found.', 404)
      await student(tx, owner, payment.student_id, input.revision)
      if (input.amountAgorot > payment.net_agorot) fail('Reversal exceeds the remaining payment.')
      await tx.execute({ sql: 'INSERT INTO payment_reversals(id,owner_id,student_id,payment_id,agorot,action_id,reason) VALUES(?,?,?,?,?,?,?)', args: [id(), owner, payment.student_id, payment.id, input.amountAgorot, input.actionId, reason] })
      const unwind = Math.max(0, input.amountAgorot - (payment.net_agorot - payment.allocated_agorot))
      await reverseAllocations(tx, owner, payment.student_id, payment.id, unwind)
      await updateRevision(tx, payment.student_id)
      await refreshHold(tx, payment.student_id)
    })
    return getBilling(owner, monthKey(input.month))
  }

  async function adjustInvoice(owner, input) {
    requireRevision(input.revision)
    monthKey(input.month)
    requireId(input.actionId)
    requireMoney(input.chargeAgorot, true)
    const reason = requireEvidence(input.evidence)
    await transaction(db, async tx => {
      const previous = await one(tx, 'SELECT * FROM invoice_adjustments WHERE owner_id=? AND id=?', [owner, input.actionId])
      if (previous) {
        if (previous.invoice_id !== input.invoiceId || previous.reason !== reason || previous.target_agorot !== input.chargeAgorot) fail('Adjustment action ID was reused.')
        return
      }
      const bill = await one(tx, 'SELECT * FROM invoice_balances WHERE owner_id=? AND id=?', [owner, input.invoiceId])
      if (!bill) fail('Invoice not found.', 404)
      await student(tx, owner, bill.student_id, input.revision)
      let unwind = Math.max(0, bill.paid_agorot - input.chargeAgorot)
      if (unwind) {
        const allocations = await query(tx, `SELECT a.*,a.agorot+COALESCE((SELECT SUM(r.agorot) FROM payment_allocations r WHERE r.reverses_id=a.id),0) AS available
          FROM payment_allocations a WHERE a.invoice_id=? AND a.agorot>0 ORDER BY a.rowid DESC`, [bill.id])
        for (const a of allocations) {
          const take = Math.min(unwind, a.available)
          if (take > 0) {
            await tx.execute({ sql: 'INSERT INTO payment_allocations(id,owner_id,student_id,payment_id,invoice_id,agorot,reverses_id) VALUES(?,?,?,?,?,?,?)', args: [id(), owner, bill.student_id, a.payment_id, bill.id, -take, a.id] })
            unwind -= take
          }
        }
        if (unwind) fail('Cannot reconcile the invoice allocations.')
      }
      await tx.execute({ sql: 'INSERT INTO invoice_adjustments(id,owner_id,student_id,invoice_id,agorot,target_agorot,reason) VALUES(?,?,?,?,?,?,?)', args: [input.actionId, owner, bill.student_id, bill.id, input.chargeAgorot - bill.total_agorot, input.chargeAgorot, reason] })
      await tx.execute({ sql: 'UPDATE invoices SET version=version+1 WHERE id=?', args: [bill.id] })
      await updateRevision(tx, bill.student_id)
      await refreshHold(tx, bill.student_id)
    })
    return getBilling(owner, monthKey(input.month))
  }

  async function addAlias(owner, input) {
    monthKey(input.month)
    const alias = normalizeAlias(input.alias)
    if (!alias || alias.length > 160) fail('Invalid student alias.', 400)
    await transaction(db, async tx => {
      await student(tx, owner, input.studentId)
      const previous = await one(tx, 'SELECT student_id FROM student_aliases WHERE owner_id=? AND alias=?', [owner, alias])
      if (previous && previous.student_id !== input.studentId) fail('This name already belongs to another student. Review before merging billing history.')
      await tx.execute({ sql: 'INSERT INTO student_aliases(owner_id,alias,student_id) VALUES(?,?,?) ON CONFLICT DO NOTHING', args: [owner, alias, input.studentId] })
    })
    return getBilling(owner, monthKey(input.month))
  }

  async function openingBalance(owner, input) {
    requireRevision(input.revision)
    requireId(input.actionId)
    requireMoney(input.amountAgorot)
    const evidence = requireEvidence(input.evidence)
    monthKey(input.month)
    await transaction(db, async tx => {
      await student(tx, owner, input.studentId)
      const previous = await one(tx, "SELECT * FROM invoices WHERE owner_id=? AND student_id=? AND month='0001-01'", [owner, input.studentId])
      if (previous) {
        if (previous.id === input.actionId && previous.charge_agorot === input.amountAgorot && previous.snapshot === evidence) return
        fail('An opening balance already exists. Adjust its original record instead.')
      }
      await student(tx, owner, input.studentId, input.revision)
      await tx.execute({ sql: "INSERT INTO invoices(id,owner_id,student_id,month,charge_agorot,source,snapshot) VALUES(?,?,?,'0001-01',?,'opening',?)", args: [input.actionId, owner, input.studentId, input.amountAgorot, evidence] })
      await updateRevision(tx, input.studentId)
    })
    return getBilling(owner, input.month)
  }

  async function importLegacy(owner, input) {
    monthKey(input.month)
    if (!Array.isArray(input.entries) || input.entries.length > 500) fail('Provide at most 500 historical links.', 400)
    const entries = []
    for (const entry of input.entries) {
      monthKey(entry.month)
      requireMoney(entry.amountAgorot)
      if (typeof entry.link !== 'string' || !entry.link.startsWith('https://') || entry.link.length > 2000) fail('Invalid historical link.', 400)
      entries.push({ ...entry, id: await digest([owner, normalizeAlias(entry.student), entry.month, entry.link, entry.amountAgorot]) })
    }
    await transaction(db, async tx => {
      const aliases = await aliasMap(tx, owner)
      const existing = new Set((await query(tx, 'SELECT id FROM legacy_links WHERE owner_id=?', [owner])).map(row => row.id))
      const statements = []
      for (const entry of entries) {
        if (existing.has(entry.id)) continue
        const s = importedStudent(owner, normalizeAlias(entry.student), aliases, statements)
        statements.push({ sql: 'INSERT INTO legacy_links(id,owner_id,student_id,month,url,amount_agorot) VALUES(?,?,?,?,?,?)', args: [entry.id, owner, s.id, entry.month, entry.link, entry.amountAgorot] })
        statements.push({ sql: "UPDATE students SET hold=COALESCE(hold,'Historical payment link — check its payment/closure status in Grow.') WHERE id=?", args: [s.id] })
        existing.add(entry.id)
      }
      if (statements.length) await tx.batch(statements)
    })
    return { imported: entries.length }
  }
  async function resolveLegacy(owner, input) {
    monthKey(input.month)
    const evidence = requireEvidence(input.evidence)
    if (input.providerClosed !== true) fail('Check the historical link is paid or closed in Grow first.', 400)
    await transaction(db, async tx => {
      const link = await one(tx, 'SELECT * FROM legacy_links WHERE owner_id=? AND id=?', [owner, input.legacyId])
      if (!link) fail('Historical link not found.', 404)
      if (link.reviewed) {
        if (link.evidence !== evidence) fail('This historical link was already reviewed with different evidence.')
        return
      }
      await student(tx, owner, link.student_id)
      await tx.execute({ sql: 'UPDATE legacy_links SET reviewed=1,evidence=? WHERE id=?', args: [evidence, link.id] })
      await updateRevision(tx, link.student_id)
      await refreshHold(tx, link.student_id)
    })
    return getBilling(owner, input.month)
  }

  async function getRequest(owner, requestId) {
    requireId(requestId)
    const r = await one(db, 'SELECT id,state,student_id,amount_agorot FROM payment_requests WHERE owner_id=? AND id=?', [owner, requestId])
    if (!r) fail('Payment request not found.', 404)
    return { id: r.id, state: r.state, studentId: r.student_id, amountAgorot: r.amount_agorot }
  }
  async function resolveApproval(owner, input) {
    monthKey(input.month)
    const evidence = requireEvidence(input.evidence)
    await transaction(db, async tx => {
      const job = await one(tx, `SELECT j.id,e.id AS event_id FROM integration_jobs j JOIN payment_events e ON e.id=j.event_id
        JOIN payment_requests r ON r.id=e.request_id WHERE j.id=? AND r.owner_id=? AND j.operation='approve' AND e.state='confirmed'`, [input.jobId, owner])
      if (!job) fail('Acknowledgement job not found.', 404)
      await tx.execute({ sql: "UPDATE integration_jobs SET state='done',error=?,generation=generation+1,lease_until=0 WHERE id=?", args: [`Manually checked: ${evidence}`, job.id] })
      await scheduleResolvedPayloads(tx, now())
    })
    return getBilling(owner, input.month)
  }
  return { getBilling, saveMonth, claimRequest, completeRequest, unknownRequest, recordManual, confirmEvent, resolveEvent, resolveApproval, closeRequest, reversePayment, adjustInvoice, addAlias, openingBalance, importLegacy, resolveLegacy, getRequest }
}
