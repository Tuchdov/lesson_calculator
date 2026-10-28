import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase, one } from '../../src/api/db.js'
import { migrate } from '../../src/api/migrations.js'
import { readMigrations } from '../../scripts/migrate.js'
import { createBillingRepository } from '../../src/api/billingRepository.js'
import createLink from '../../api/create-payment-link.js'
import billing from '../../api/billing.js'
import notify from '../../api/grow-notify.js'
import resultCallback from '../../api/payment-link-result.js'
import jobs from '../../api/payment-jobs.js'

async function invoke(handler, { method = 'POST', body, headers = {}, query = {} } = {}) {
  const res = { headers: {}, setHeader(name, value) { this.headers[name] = value }, status(status) { this.statusCode = status; return this }, json(value) { this.body = value; return this } }
  await handler({ method, body, headers, query }, res)
  return res
}

test('real API adapters authenticate batches once, persist results, and protect integration endpoints', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lesson-api-'))
  const url = `file:${join(directory, 'ledger.db')}`
  const db = createDatabase({ url })
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }) })
  await migrate(db, await readMigrations())
  const environment = {
    TURSO_DATABASE_URL: url, GROW_ENVIRONMENT: 'sandbox', GROW_MERCHANT_ID: 'api-test', BILLING_MODE: 'live',
    ALLOWED_EMAIL: 'teacher@example.com', VITE_GOOGLE_CLIENT_ID: 'client-123', MAKE_WEBHOOK_URL: 'https://make.example/create',
    MAKE_API_KEY: 'create-api-key', MAKE_RESULT_SECRET: 'r'.repeat(32), MAKE_NOTIFY_SECRET: 'n'.repeat(32), PAYMENT_JOBS_SECRET: 'j'.repeat(32),
    PAYMENT_PAYLOAD_KEY: Buffer.alloc(32, 8).toString('base64'),
  }
  const previous = {}
  for (const [name, value] of Object.entries(environment)) { previous[name] = process.env[name]; process.env[name] = value }
  t.after(() => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } })
  await db.execute("UPDATE billing_control SET mode='normal',environment='sandbox',merchant='api-test',signed_off_at=CURRENT_TIMESTAMP")
  const repo = createBillingRepository(db, { mode: 'live', environment: 'sandbox', merchant: 'api-test' })
  const data = await repo.saveMonth(environment.ALLOWED_EMAIL, { month: '2026-08', entries: [{ student: 'Alice Smith', chargeAgorot: 30000 }, { student: 'Bob Jones', chargeAgorot: 40000 }] })
  let googleCalls = 0
  let makeCalls = 0
  t.mock.method(globalThis, 'fetch', async (uri, request) => {
    if (uri.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      googleCalls++
      return { ok: true, json: async () => ({ email: environment.ALLOWED_EMAIL, aud: environment.VITE_GOOGLE_CLIENT_ID, expires_in: 3600 }) }
    }
    assert.equal(uri, environment.MAKE_WEBHOOK_URL)
    const body = JSON.parse(request.body)
    assert.equal(body.amount, body.amount_agorot / 100)
    assert.equal(body.billing_reference, body.request_id)
    makeCalls++
    return { ok: true, json: async () => ({ status: 1, data: { url: `https://pay.example/${makeCalls}`, paymentLinkProcessId: `process${makeCalls}`, paymentLinkProcessToken: 'process-token' } }) }
  })
  const headers = { authorization: 'Bearer test-token' }
  const items = data.students.map(s => ({ studentId: s.id, revision: s.revision, requestId: crypto.randomUUID(), month: '2026-08', studentName: s.name, phone: '0501234567', amount: 1 }))
  let response = await invoke(createLink, { headers, body: { items } })
  assert.equal(response.statusCode, 200)
  assert.equal(googleCalls, 1)
  assert.equal(makeCalls, 2)
  assert.deepEqual(response.body.results.map(r => r.amountAgorot).sort(), [30000, 40000])
  assert.equal(response.headers['Cache-Control'], 'no-store')
  response = await invoke(createLink, { headers, body: { items } })
  assert.equal(googleCalls, 2)
  assert.equal(makeCalls, 2)
  assert.equal(response.body.results.every(r => r.state === 'ready'), true)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_requests')).n, 2)
  assert.equal((await invoke(billing, { method: 'GET', query: { month: '2026-08' } })).statusCode, 401)
  assert.equal((await invoke(notify, { method: 'GET' })).statusCode, 405)
  const notifyHeaders = { 'x-make-notify-secret': environment.MAKE_NOTIFY_SECRET }
  assert.equal((await invoke(notify, { body: { data: 'invalid' }, headers: notifyHeaders })).statusCode, 400)
  assert.equal((await invoke(resultCallback, { headers: { 'x-make-result-secret': 'incorrect' }, body: {} })).statusCode, 401)
  assert.equal((await invoke(jobs, { headers: { 'x-payment-jobs-secret': 'incorrect' } })).statusCode, 401)
  const body = { status: 1, data: { paymentLinkProcessId: 'process1', transactionId: 'transaction1', statusCode: '2', sum: '300', transactionToken: 'callback-secret' } }
  assert.equal((await invoke(notify, { body })).statusCode, 401)
  assert.equal((await invoke(notify, { body, headers: { 'x-make-notify-secret': 'incorrect' } })).statusCode, 401)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payment_events')).n, 0)
  const received = await invoke(notify, { body, headers: notifyHeaders })
  assert.equal(received.statusCode, 200)
  assert.equal((await one(db, 'SELECT forwarding_authenticated FROM payment_events')).forwarding_authenticated, 1)
  assert.equal((await one(db, 'SELECT COUNT(*) AS n FROM payments')).n, 0)
  delete process.env.MAKE_NOTIFY_SECRET
  const anonymous = await invoke(notify, { body: { ...body, authenticated: true, data: { ...body.data, transactionId: 'anonymous1', authenticated: true } } })
  assert.equal(anonymous.statusCode, 200)
  assert.equal((await one(db, "SELECT request_id FROM payment_events WHERE transaction_id='anonymous1'")).request_id, null)
  assert.equal((await invoke(notify, { body, headers: notifyHeaders })).statusCode, 503)
  const accountMismatch = await invoke(billing, { method: 'GET', headers: { ...headers, 'x-billing-owner': 'old@example.com' }, query: { month: '2026-08' } })
  assert.equal(accountMismatch.statusCode, 409)
  const visible = await invoke(billing, { method: 'GET', headers, query: { month: '2026-08' } })
  assert.equal(visible.statusCode, 200)
  assert.equal(JSON.stringify(visible.body).includes('callback-secret'), false)
  assert.equal(JSON.stringify(visible.body).includes('process-token'), false)
  process.env.GROW_ENVIRONMENT = 'production'
  assert.equal((await invoke(billing, { method: 'GET', headers, query: { month: '2026-08' } })).statusCode, 503)
})
