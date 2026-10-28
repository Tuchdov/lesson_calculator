import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, one, query } from '../../src/api/db.js'
import { migrate } from '../../src/api/migrations.js'
import { readMigrations } from '../../scripts/migrate.js'
import { createBillingRepository } from '../../src/api/billingRepository.js'
import { createPaymentEvents } from '../../src/api/paymentEvents.js'
import { prepareDurableLink, prepareDurableBatch } from '../../src/api/durablePaymentService.js'

const owner = 'teacher@example.com'
const options = { environment: 'sandbox', merchant: 'test-merchant', mode: 'live', apiKey: 'test-api-key', payloadKey: Buffer.alloc(32, 7).toString('base64') }
async function setup(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lesson-ledger-'))
  const db = createDatabase({ url: `file:${join(directory, 'billing.db')}` })
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }) })
  await migrate(db, await readMigrations())
  await db.execute("UPDATE billing_control SET mode='normal',signed_off_at=CURRENT_TIMESTAMP")
  return { directory, db, repo: createBillingRepository(db, { ...options, ...overrides }), events: createPaymentEvents(db, { ...options, ...overrides }) }
}
async function save(repo, month = '2026-08', amount = 30000, student = 'Alice Smith') {
  const billing = await repo.saveMonth(owner, { month, entries: [{ student, chargeAgorot: amount, version: null }] })
  return billing.students.find(s => s.name === student)
}
function input(s, overrides = {}) {
  return { studentId: s.id, requestId: crypto.randomUUID(), revision: s.revision, month: '2026-08', phone: '0501234567', studentName: 'Alice Smith', ...overrides }
}
const result = { link: 'https://pay.example/link', processId: 'process123', processToken: 'secret-token', amountAgorot: 30000 }
function notification(overrides = {}) {
  return { status: '1', data: { paymentLinkProcessId: result.processId, transactionId: 'transaction123', transactionToken: 'txn-secret', statusCode: '2', status: 'שולם', sum: '300', paymentDate: '1/8/26', ...overrides } }
}
async function ready(repo, s, overrides = {}) {
  const r = await repo.claimRequest(owner, input(s))
  await repo.completeRequest(r.id, { ...result, ...overrides })
  return r
}

test('migrations are repeatable, detect changed versions, and rollback a failed migration', async t => {
  const { db } = await setup(t)
  const migrations = await readMigrations()
  await migrate(db, migrations)
  await assert.rejects(migrate(db, [{ ...migrations[0], checksum: 'changed' }]), /modified/)
  await assert.rejects(migrate(db, [...migrations, { version: 3, checksum: 'bad', sql: 'CREATE TABLE should_rollback(id TEXT); INSERT INTO nonexistent VALUES(1)' }]))
  assert.equal(await one(db, "SELECT name FROM sqlite_master WHERE name='should_rollback'"), null)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM schema_migrations')).n, 2)
})

test('partial payments carry once across months and never create a duplicated charge', async t => {
  const { repo, events, db } = await setup(t)
  let s = await save(repo)
  await repo.recordManual(owner, { ...input(s), actionId: crypto.randomUUID(), source: 'bank', amountAgorot: 10000, evidence: 'Bank receipt 12345' })
  s = await save(repo, '2026-09', 40000)
  assert.equal(s.priorAgorot, 20000)
  assert.equal(s.remainingAgorot, 60000)
  const r = await repo.claimRequest(owner, input(s, { month: '2026-09' }))
  assert.equal(r.amount_agorot, 60000)
  await repo.completeRequest(r.id, { ...result, amountAgorot: 60000 })
  await events.receive(notification({ sum: '600' }), { authenticated: true })
  const report = await one(db, 'SELECT id FROM payment_events')
  await repo.confirmEvent(owner, { eventId: report.id, month: '2026-09', evidence: 'Checked Grow transaction and amount' })
  s = (await repo.getBilling(owner, '2026-09')).students[0]
  assert.equal(s.remainingAgorot, 0)
  assert.equal(s.priorAgorot, 0)
  assert.equal(s.invoices.length, 2)
  assert.equal(s.invoices.reduce((n, invoice) => n + invoice.chargeAgorot, 0), 70000)
  assert.equal((await repo.getBilling(owner, '2026-09')).students[0].remainingAgorot, 0)
})

test('identical concurrent requests dispatch once; cross-month requests cannot overlap', async t => {
  const { repo, db } = await setup(t)
  const s = await save(repo)
  const payload = input(s)
  const attempts = await Promise.allSettled([repo.claimRequest(owner, payload), repo.claimRequest(owner, payload)])
  assert.equal(attempts.filter(r => r.status === 'fulfilled' && r.value.dispatch).length, 1)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_requests')).n, 1)
  const existing = attempts.find(r => r.status === 'fulfilled' && r.value.dispatch).value
  await repo.completeRequest(existing.id, result)
  const september = await save(repo, '2026-09', 40000)
  await assert.rejects(repo.claimRequest(owner, input(september, { month: '2026-09' })), /existing payment link/)
})

test('a lost creation response is held; retries cannot call Make again; late results recover it', async t => {
  const { repo, db } = await setup(t)
  const s = await save(repo)
  const payload = input(s)
  let calls = 0
  const provider = { webhookUrl: 'https://make.example/create', apiKey: 'test-key', fetchImpl: async () => { calls++; throw new Error('timeout') } }
  await assert.rejects(prepareDurableLink(repo, owner, payload, provider), /uncertain/)
  const retry = await prepareDurableLink(repo, owner, payload, provider)
  assert.equal(retry.state, 'unknown')
  assert.equal(calls, 1)
  const r = await one(db, 'SELECT * FROM payment_requests')
  await repo.completeRequest(r.id, result)
  const recovered = await prepareDurableLink(repo, owner, payload, provider)
  assert.equal(recovered.link, result.link)
  assert.equal(calls, 1)
  await assert.rejects(repo.claimRequest(owner, { ...payload, phone: '0507654321' }), /different payment details/)
})

test('callbacks before link results are quarantined, then matched; no payment is posted automatically', async t => {
  const { repo, events, db } = await setup(t)
  const s = await save(repo)
  const r = await repo.claimRequest(owner, input(s))
  await events.receive(notification(), { authenticated: true })
  assert.equal((await one(db, 'SELECT state FROM payment_events')).state, 'quarantined')
  await repo.completeRequest(r.id, result)
  await events.runJobs()
  const billing = await repo.getBilling(owner, '2026-08')
  assert.equal(billing.students[0].pending.length, 1)
  assert.ok(billing.students[0].hold)
  assert.equal(billing.students[0].remainingAgorot, 30000)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 0)
  assert.equal((await one(db, 'SELECT state FROM integration_jobs')).state, 'needs_review')
})

test('multiple receipts and manual confirmation of one transaction post principal once', async t => {
  const { repo, events, db } = await setup(t)
  const s = await save(repo)
  await ready(repo, s)
  await events.receive(notification(), { authenticated: true })
  await events.receive(notification(), { authenticated: true })
  await events.receive(notification({ paymentDate: '01/08/26' }), { authenticated: true })
  const reports = await query(db, 'SELECT id FROM payment_events')
  assert.equal(reports.length, 2)
  for (const report of reports) await repo.confirmEvent(owner, { eventId: report.id, month: '2026-08', evidence: 'Checked transaction in Grow dashboard' })
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 1)
  assert.equal((await one(db, 'SELECT SUM(agorot) AS n FROM payment_allocations')).n, 30000)
  assert.equal((await one(db, "SELECT COUNT(*) AS n FROM integration_jobs WHERE operation='approve'")).n, 1)
  const paid = (await repo.getBilling(owner, '2026-08')).students[0]
  assert.equal(paid.remainingAgorot, 0)
  assert.equal(paid.hold, null)
})

test('principal, allocations and acknowledgement jobs roll back together on failure', async t => {
  const { repo, events, db } = await setup(t)
  const s = await save(repo)
  await ready(repo, s)
  await events.receive(notification(), { authenticated: true })
  const report = await one(db, 'SELECT id FROM payment_events')
  // Inject a real constraint failure at the final acknowledgement insert.
  await db.execute("CREATE TRIGGER fail_approval BEFORE INSERT ON integration_jobs WHEN NEW.operation='approve' BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
  await assert.rejects(repo.confirmEvent(owner, { eventId: report.id, month: '2026-08', evidence: 'Dashboard verified transaction' }))
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 0)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_allocations')).n, 0)
  assert.equal((await one(db, 'SELECT state FROM payment_events')).state, 'reported')
})

test('intake rolls back receipt and encrypted payload when job insertion fails', async t => {
  const { events, db } = await setup(t)
  await db.execute("CREATE TRIGGER fail_job BEFORE INSERT ON integration_jobs BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
  await assert.rejects(events.receive(notification()))
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_events')).n, 0)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM integration_payloads')).n, 0)
})

test('reversals consume excess first, then reopen original invoices, and are idempotent', async t => {
  const { repo, db } = await setup(t)
  let s = await save(repo)
  const paid = await repo.recordManual(owner, { ...input(s), source: 'cash', actionId: crypto.randomUUID(), amountAgorot: 40000, evidence: 'Cash received and counted' })
  s = paid.students[0]
  assert.ok(s.hold)
  assert.equal(s.payments[0].creditAgorot, 10000)
  const reverse = { paymentId: s.payments[0].id, month: '2026-08', revision: s.revision, actionId: crypto.randomUUID(), amountAgorot: 15000, evidence: 'Refund returned to student' }
  await repo.reversePayment(owner, reverse)
  await repo.reversePayment(owner, reverse)
  s = (await repo.getBilling(owner, '2026-08')).students[0]
  assert.equal(s.remainingAgorot, 5000)
  assert.equal(s.payments[0].creditAgorot, 0)
  assert.equal((await one(db, 'SELECT SUM(agorot) AS n FROM payment_allocations')).n, 25000)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_reversals')).n, 1)
})

test('cash settlement does not release an already delivered Grow link', async t => {
  const { repo } = await setup(t)
  let s = await save(repo)
  const r = await ready(repo, s)
  s = (await repo.recordManual(owner, { ...input(s), actionId: crypto.randomUUID(), source: 'bank', amountAgorot: 30000, evidence: 'Bank transfer reference ABC' })).students[0]
  assert.equal(s.request.reusable, false)
  assert.equal(s.request.id, r.id)
  s = await save(repo, '2026-09', 40000)
  await assert.rejects(repo.claimRequest(owner, input(s, { month: '2026-09' })), /existing payment link/)
})

test('owner isolation, aliases and recovery gates apply even to known identifiers', async t => {
  const { repo, db } = await setup(t)
  const s = await save(repo)
  await assert.rejects(repo.recordManual('other@example.com', { ...input(s), source: 'cash', actionId: crypto.randomUUID(), amountAgorot: 100, evidence: 'Cash receipt checked' }), /not found/)
  await repo.addAlias(owner, { studentId: s.id, alias: 'Alice Renamed', month: '2026-08' })
  const renamed = await save(repo, '2026-09', 40000, 'Alice Renamed')
  assert.equal(renamed, undefined) // display name is stable; alias does not create a second student.
  assert.equal((await repo.getBilling(owner, '2026-09')).students.length, 1)
  await db.execute("UPDATE billing_control SET mode='recovery'")
  await assert.rejects(repo.claimRequest(owner, input(s)), /recovery/)
  assert.equal((await repo.getBilling('other@example.com', '2026-08')).students.length, 0)
})

test('reducing a paid invoice creates held credit; changed adjustment retries are rejected', async t => {
  const { repo } = await setup(t)
  let s = await save(repo)
  s = (await repo.recordManual(owner, { ...input(s), source: 'bank', actionId: crypto.randomUUID(), amountAgorot: 30000, evidence: 'Bank transaction checked' })).students[0]
  const adjustment = { invoiceId: s.invoices[0].id, actionId: crypto.randomUUID(), revision: s.revision, month: '2026-08', chargeAgorot: 20000, evidence: 'Lesson cancelled and charge corrected' }
  await repo.adjustInvoice(owner, adjustment)
  await assert.rejects(repo.adjustInvoice(owner, { ...adjustment, chargeAgorot: 10000 }), /reused/)
  s = (await repo.getBilling(owner, '2026-08')).students[0]
  assert.equal(s.remainingAgorot, 0)
  assert.equal(s.payments[0].creditAgorot, 10000)
  assert.ok(s.hold)
})

test('legacy links import idempotently without establishing debt and block collection until reviewed', async t => {
  const { repo, db } = await setup(t)
  const entry = { student: 'Alice Smith', month: '2026-07', link: 'https://pay.example/old', amountAgorot: 50000 }
  await repo.importLegacy(owner, { month: '2026-08', entries: [entry] })
  await repo.importLegacy(owner, { month: '2026-08', entries: [entry] })
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM invoices')).n, 0)
  let s = await save(repo)
  assert.equal(s.remainingAgorot, 30000)
  assert.equal(s.legacy.length, 1)
  await assert.rejects(repo.claimRequest(owner, input(s)), /Historical/)
  await repo.resolveLegacy(owner, { month: '2026-08', legacyId: s.legacy[0].id, providerClosed: true, evidence: 'Old link checked and closed in Grow' })
  s = (await repo.getBilling(owner, '2026-08')).students[0]
  assert.equal(s.hold, null)
  assert.equal(s.remainingAgorot, 30000)
  await repo.importLegacy(owner, { month: '2026-08', entries: [entry] })
  assert.equal((await repo.getBilling(owner, '2026-08')).students[0].hold, null)
})

test('approval replays encrypted payload, purges only after success, and retains ledger evidence', async t => {
  let clock = Date.now()
  const calls = []
  const { repo, events, db } = await setup(t, {
    now: () => clock,
    operationsUrl: 'https://make.example/operations', apiKey: 'test-api-key',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      calls.push(body)
      return { ok: true, json: async () => ({ version: 1, action: 'approve', jobId: body.jobId, approved: true }) }
    },
  })
  const s = await save(repo)
  await ready(repo, s)
  await events.receive(notification(), { authenticated: true })
  await events.receive(notification({ paymentDate: '01/08/26' }), { authenticated: true })
  const payload = await one(db, 'SELECT * FROM integration_payloads')
  assert.equal(payload.ciphertext.includes('txn-secret'), false)
  const event = await one(db, 'SELECT id FROM payment_events')
  await repo.confirmEvent(owner, { eventId: event.id, month: '2026-08', evidence: 'Verified payment in Grow dashboard' })
  await events.runJobs()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].data.transactionToken, 'txn-secret')
  assert.equal((await one(db, "SELECT state FROM integration_jobs WHERE operation='approve'")).state, 'done')
  assert.ok((await one(db, 'SELECT ciphertext FROM integration_payloads')).ciphertext)
  await events.receive(notification({ paymentDate: '1/08/2026' }), { authenticated: true })
  const duplicate = await one(db, "SELECT id FROM payment_events WHERE state='reported'")
  await repo.confirmEvent(owner, { eventId: duplicate.id, month: '2026-08', evidence: 'Verified duplicate transaction in Grow dashboard' })
  clock += 86_400_001
  await events.runJobs()
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM integration_payloads WHERE ciphertext IS NOT NULL')).n, 0)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 1)
})

test('uncertain approvals are not blindly retried; expired payloads remain review items', async t => {
  let clock = Date.now()
  let calls = 0
  const { repo, events, db } = await setup(t, { now: () => clock, operationsUrl: 'https://make.example/operations', fetchImpl: async () => { calls++; throw new Error('timeout') } })
  const s = await save(repo)
  await ready(repo, s)
  await events.receive(notification(), { authenticated: true })
  const event = await one(db, 'SELECT id FROM payment_events')
  await repo.confirmEvent(owner, { eventId: event.id, month: '2026-08', evidence: 'Checked dashboard receipt' })
  await events.runJobs()
  await events.runJobs()
  assert.equal(calls, 1)
  assert.equal((await one(db, "SELECT state FROM integration_jobs WHERE operation='approve'")).state, 'needs_review')
  clock += 8 * 86_400_000
  await events.runJobs()
  assert.ok((await one(db, 'SELECT ciphertext FROM integration_payloads')).ciphertext)
})

test('a stale worker cannot overwrite a newer review decision', async t => {
  let signalStarted
  const started = new Promise(resolve => { signalStarted = resolve })
  let finishRequest
  const { repo, events, db } = await setup(t, { operationsUrl: 'https://make.example/operations', fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body)
    signalStarted()
    await new Promise(resolve => { finishRequest = resolve })
    return { ok: true, json: async () => ({ version: 1, action: 'approve', jobId: body.jobId, approved: true }) }
  } })
  await ready(repo, await save(repo))
  await events.receive(notification(), { authenticated: true })
  const event = await one(db, 'SELECT id FROM payment_events')
  await repo.confirmEvent(owner, { eventId: event.id, month: '2026-08', evidence: 'Verified Grow transaction' })
  const running = events.runJobs()
  await started
  await db.execute("UPDATE integration_jobs SET generation=generation+1,state='needs_review' WHERE operation='approve'")
  finishRequest()
  await running
  assert.equal((await one(db, "SELECT state FROM integration_jobs WHERE operation='approve'")).state, 'needs_review')
  assert.equal((await one(db, 'SELECT purge_after FROM integration_payloads')).purge_after, null)
})

test('restoring an older snapshot blocks creation even though its request deduplication keys are gone', async t => {
  const { repo, db, directory } = await setup(t)
  const s = await save(repo)
  const backup = join(directory, 'backup.db')
  await db.execute({ sql: 'VACUUM INTO ?', args: [backup] })
  const payload = input(s)
  await ready(repo, s)
  const restored = createDatabase({ url: `file:${backup}` })
  try {
    assert.equal((await one(restored, 'SELECT COUNT(*) AS n FROM payment_requests')).n, 0)
    const recovery = createBillingRepository(restored, { ...options, mode: 'recovery' })
    await assert.rejects(recovery.claimRequest(owner, payload), /recovery/)
    assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_requests')).n, 1)
  } finally { restored.close() }
})

test('invalid months cannot commit payments and foreign keys reject cross-owner allocations', async t => {
  const { repo, events, db } = await setup(t)
  const s = await save(repo)
  const r = await ready(repo, s)
  await events.receive(notification(), { authenticated: true })
  const event = await one(db, 'SELECT id FROM payment_events')
  await assert.rejects(repo.confirmEvent(owner, { eventId: event.id, month: 'bad', evidence: 'Verified in Grow dashboard' }), /month/)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 0)
  await assert.rejects(db.execute({ sql: 'INSERT INTO payments(id,owner_id,student_id,source,identity,amount_agorot,evidence,request_id) VALUES(?,?,?,?,?,?,?,?)', args: [crypto.randomUUID(), 'other@example.com', s.id, 'cash', 'some-id', 100, 'Checked', r.id] }), /FOREIGN KEY/)
})

test('a late provider result after a reviewed cancellation holds collection, even if another request exists', async t => {
  const { repo } = await setup(t)
  let s = await save(repo)
  const old = await repo.claimRequest(owner, input(s))
  await repo.unknownRequest(old.id)
  await assert.rejects(repo.closeRequest(owner, { requestId: old.id, revision: s.revision, month: '2026-08', providerClosed: true, evidence: 'Looked at the Grow dashboard' }), /Make execution/)
  await repo.closeRequest(owner, { requestId: old.id, revision: s.revision, month: '2026-08', providerClosed: true, dispatchSettled: true, evidence: 'Make execution ended; Grow closure and final payment state checked' })
  s = (await repo.getBilling(owner, '2026-08')).students[0]
  const newer = await repo.claimRequest(owner, input(s))
  await repo.completeRequest(newer.id, { ...result, processId: 'newer-process' })
  const late = await repo.completeRequest(old.id, result)
  assert.equal(late.state, 'needs_review')
  s = (await repo.getBilling(owner, '2026-08')).students[0]
  assert.ok(s.hold)
  assert.equal(s.request.reusable, false)
  await assert.rejects(repo.claimRequest(owner, input(s)), /Conflicting/)
  assert.equal(s.reviewRequests[0].id, old.id)
  await repo.closeRequest(owner, { requestId: old.id, revision: s.revision, month: '2026-08', providerClosed: true, dispatchSettled: true, evidence: 'Unexpected late link checked and closed in Grow; Make execution finished' })
  assert.equal((await repo.getBilling(owner, '2026-08')).students[0].hold, null)
})

test('unsupported installment/currency reports require reconciliation and cannot post principal', async t => {
  const { repo, events, db } = await setup(t)
  await ready(repo, await save(repo))
  await events.receive(notification({ allPaymentsNum: '12', paymentType: '4' }), { authenticated: true })
  const report = await one(db, 'SELECT id FROM payment_events')
  await assert.rejects(repo.confirmEvent(owner, { eventId: report.id, month: '2026-08', evidence: 'Checked transaction in dashboard' }), /single-payment/)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 0)
  await repo.resolveEvent(owner, { eventId: report.id, month: '2026-08', evidence: 'Unsupported transaction reconciled separately in Grow' })
  assert.equal((await one(db, 'SELECT state FROM payment_events')).state, 'dismissed')
})


test('replaying resolved review actions cannot invalidate a later ready link', async t => {
  for (const kind of ['event', 'legacy']) {
    const { repo, events } = await setup(t)
    let s = await save(repo)
    let replay
    if (kind === 'event') {
      const old = await ready(repo, s)
      await events.receive(notification({ statusCode: '3' }), { authenticated: true })
      s = (await repo.getBilling(owner, '2026-08')).students[0]
      const action = { eventId: s.pending[0].id, month: '2026-08', evidence: 'Checked unsuccessful charge in Grow' }
      await repo.resolveEvent(owner, action)
      s = (await repo.getBilling(owner, '2026-08')).students[0]
      await repo.closeRequest(owner, { requestId: old.id, month: '2026-08', revision: s.revision, providerClosed: true, dispatchSettled: true, evidence: 'Make finished and old link closed in Grow' })
      replay = () => repo.resolveEvent(owner, action)
    } else {
      await repo.importLegacy(owner, { month: '2026-08', entries: [{ month: '2026-07', student: s.name, link: 'https://pay.example/legacy', amountAgorot: 10000 }] })
      s = (await repo.getBilling(owner, '2026-08')).students[0]
      const action = { legacyId: s.legacy[0].id, month: '2026-08', providerClosed: true, evidence: 'Historical link checked and closed in Grow' }
      await repo.resolveLegacy(owner, action)
      replay = () => repo.resolveLegacy(owner, action)
    }
    s = (await repo.getBilling(owner, '2026-08')).students[0]
    const next = await repo.claimRequest(owner, input(s))
    await repo.completeRequest(next.id, { ...result, processId: 'new-process' })
    const before = (await repo.getBilling(owner, '2026-08')).students[0]
    assert.equal(before.request.reusable, true)
    await replay()
    const after = (await repo.getBilling(owner, '2026-08')).students[0]
    assert.equal(after.request.reusable, true, kind)
    assert.equal(after.revision, before.revision, kind)
  }
})

test('batch preparation defers later items after its dispatch budget without claiming them', async t => {
  const { repo, db } = await setup(t)
  const data = await repo.saveMonth(owner, { month: '2026-08', entries: Array.from({ length: 7 }, (_, i) => ({ student: `Student ${String(i).padStart(2, '0')}`, chargeAgorot: 30000 })) })
  let clock = 0
  let calls = 0
  const result = await prepareDurableBatch(repo, owner, data.students.map(s => input(s, { studentName: s.name })), {
    webhookUrl: 'https://make.example/create', apiKey: 'test-api-key', now: () => clock,
    fetchImpl: async () => {
      const current = ++calls
      clock = 40_000
      return { ok: true, json: async () => ({ status: 1, data: { url: `https://pay.example/${current}`, paymentLinkProcessId: `batch${current}`, paymentLinkProcessToken: 'token' } }) }
    },
  })
  assert.equal(result.results.filter(r => r.state === 'deferred').length, 1)
  assert.equal(calls, 6)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_requests')).n, 6)
})

test('anonymous intake cannot hold a student or exhaust authenticated request or orphan budgets', async t => {
  const { repo, events, db } = await setup(t)
  const s = await save(repo)
  await ready(repo, s)
  for (let i = 0; i < 250; i++) await events.receive(notification({ transactionId: `anonymous${i}` }))
  await assert.rejects(events.receive(notification({ transactionId: 'anonymous-overflow' })), { status: 429 })
  const unchanged = (await repo.getBilling(owner, '2026-08')).students[0]
  assert.equal(unchanged.hold, null)
  assert.equal(unchanged.pending.length, 0)
  assert.equal(unchanged.request.reusable, true)
  await events.receive(notification({ paymentLinkProcessId: 'unknown-process' }), { authenticated: true })
  // Trusted redelivery of an anonymous fingerprint must also be admitted.
  await events.receive(notification({ transactionId: 'anonymous0' }), { authenticated: true })
  for (let i = 1; i < 100; i++) await events.receive(notification({ transactionId: `trusted${i}` }), { authenticated: true })
  await assert.rejects(events.receive(notification({ transactionId: 'trusted-overflow' }), { authenticated: true }), { status: 429 })
  const duplicate = await events.receive(notification({ transactionId: 'trusted1' }), { authenticated: true })
  assert.equal(duplicate.duplicate, true)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_events WHERE request_id IS NOT NULL')).n, 100)
  assert.equal((await repo.getBilling(owner, '2026-08')).students[0].pending.length, 100)
})

test('anonymous early receipts stay quarantined until authenticated redelivery replaces their payload', async t => {
  let approved
  const { repo, events, db } = await setup(t, {
    operationsUrl: 'https://make.example/operations',
    fetchImpl: async (_url, request) => {
      approved = JSON.parse(request.body)
      return { ok: true, json: async () => ({ version: 1, action: 'approve', jobId: approved.jobId, approved: true }) }
    },
  })
  const s = await save(repo)
  const r = await repo.claimRequest(owner, input(s))
  await events.receive(notification({ payerEmail: 'untrusted@example.com' }))
  const original = await one(db, 'SELECT * FROM payment_events')
  await repo.completeRequest(r.id, result)
  assert.equal((await one(db, 'SELECT request_id FROM payment_events')).request_id, null)
  assert.equal((await repo.getBilling(owner, '2026-08')).students[0].hold, null)
  await events.runJobs()
  await events.receive(notification({ payerEmail: 'checked@example.com' }), { authenticated: true })
  const promoted = await one(db, 'SELECT * FROM payment_events')
  assert.equal(promoted.id, original.id)
  assert.equal(promoted.forwarding_authenticated, 1)
  assert.equal(promoted.request_id, r.id)
  assert.equal(promoted.state, 'reported')
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_events')).n, 1)
  await repo.confirmEvent(owner, { eventId: promoted.id, month: '2026-08', evidence: 'Verified transaction in Grow dashboard' })
  await events.runJobs()
  assert.equal(approved.data.payerEmail, 'checked@example.com')
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 1)
})

test('ledger changes require valid revisions and reject stale writes without changing records', async t => {
  const { repo, db } = await setup(t)
  let s = await save(repo)
  const r = await ready(repo, s)
  s = (await repo.recordManual(owner, { ...input(s), actionId: crypto.randomUUID(), source: 'bank', amountAgorot: 10000, evidence: 'Bank receipt checked' })).students[0]
  const base = { studentId: s.id, month: '2026-08', evidence: 'Verified transaction in bank records', actionId: crypto.randomUUID() }
  const actions = [
    ['recordManual', { ...base, source: 'cash', amountAgorot: 10000 }],
    ['closeRequest', { ...base, requestId: r.id, providerClosed: true, dispatchSettled: true }],
    ['reversePayment', { ...base, paymentId: s.payments[0].id, amountAgorot: 5000 }],
    ['adjustInvoice', { ...base, invoiceId: s.invoices[0].id, chargeAgorot: 25000 }],
    ['openingBalance', { ...base, amountAgorot: 20000 }],
  ]
  const tables = ['students', 'invoices', 'invoice_adjustments', 'payments', 'payment_reversals', 'payment_allocations', 'payment_requests']
  const snapshot = async () => Promise.all(tables.map(table => query(db, `SELECT * FROM ${table}`)))
  const records = await snapshot()
  for (const [action, payload] of actions) {
    for (const revision of [undefined, null, '2', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(repo[action](owner, { ...payload, revision }), { status: 400 }, `${action}: ${revision}`)
    }
    await assert.rejects(repo[action](owner, { ...payload, revision: s.revision - 1 }), /Billing changed/, action)
    assert.deepEqual(await snapshot(), records, action)
  }
})
