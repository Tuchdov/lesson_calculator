import { transaction, one, query } from './db.js'
import { digest, id, fail } from './billingRepository.js'
import { toAgorot } from '../lib/billing.js'
import { scheduleResolvedPayloads } from './payloadRetention.js'

const REPLAY_FIELDS = ['transactionId', 'transactionToken', 'transactionTypeId', 'paymentType', 'sum', 'firstPaymentSum', 'periodicalPaymentSum', 'paymentsNum', 'allPaymentsNum', 'paymentDate', 'asmachta', 'description', 'fullName', 'payerPhone', 'payerEmail', 'cardSuffix', 'cardType', 'cardTypeCode', 'cardBrand', 'cardBrandCode', 'cardExp', 'processId', 'processToken', 'paymentLinkProcessId', 'paymentLinkProcessToken']
const DAY = 86_400_000

async function encryptionKey(secret) {
  let bytes
  try { bytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0)) } catch { fail('Payment payload key is not configured correctly.', 503) }
  if (bytes.length !== 32) fail('Payment payload key must contain 32 base64-encoded bytes.', 503)
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function seal(data, secret, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await encryptionKey(secret), new TextEncoder().encode(JSON.stringify(data)))
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(ciphertext)))
}

async function unseal(data, secret, context) {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(context) }, await encryptionKey(secret), bytes.slice(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

export function createPaymentEvents(db, { environment, merchant, payloadKey, operationsUrl, apiKey, approvalReplaySafe = false, fetchImpl = fetch, now = Date.now }) {
  async function receive(body) {
    if (!body || JSON.stringify(body).length > 32768) fail('Invalid notification size.', 400)
    const data = body.data
    if (String(body.status) !== '1' || !data || typeof data !== 'object') fail('Invalid Grow notification envelope.', 400)
    const processId = String(data.paymentLinkProcessId ?? '').trim()
    const transactionId = String(data.transactionId ?? '').trim()
    const status = String(data.statusCode ?? '').trim()
    if (!/^[\w-]{1,100}$/.test(processId) || !/^[\w-]{1,100}$/.test(transactionId) || !/^\d{1,4}$/.test(status)) fail('Missing Grow transaction identifiers.', 400)
    let amount
    try { amount = toAgorot(data.sum) } catch { fail('Invalid notification amount.', 400) }
    if (!amount) fail('Invalid notification amount.', 400)
    const supported = (data.allPaymentsNum === undefined || Number(data.allPaymentsNum) === 1) && (data.paymentType === undefined || Number(data.paymentType) === 2) && (data.currency === undefined || data.currency === 'ILS')
    const fingerprint = await digest([processId, transactionId, status, amount, supported, String(data.transactionToken ?? ''), String(data.paymentDate ?? '')])
    const eventId = id()
    const payload = {}
    for (const field of REPLAY_FIELDS) {
      const value = data[field]
      if (value !== undefined && value !== null) {
        if (!['string', 'number'].includes(typeof value) || String(value).length > 1000) fail('Invalid notification field.', 400)
        payload[field] = value
      }
    }
    const encrypted = await seal(payload, payloadKey, eventId)
    return transaction(db, async tx => {
      const previous = await one(tx, "SELECT * FROM payment_events WHERE provider='grow' AND environment=? AND merchant=? AND fingerprint=?", [environment, merchant, fingerprint])
      if (previous) {
        if (previous.state !== 'confirmed') await tx.execute({ sql: "INSERT INTO integration_jobs(id,operation,event_id) VALUES(?,'verify',?) ON CONFLICT(operation,event_id) DO NOTHING", args: [id(), previous.id] })
        return { received: true, duplicate: true }
      }
      const request = await one(tx, 'SELECT * FROM payment_requests WHERE environment=? AND merchant=? AND process_id=?', [environment, merchant, processId])
      // Bound unauthenticated intake. Known requests also have a finite event budget.
      const count = await one(tx, `SELECT COUNT(*) AS n FROM payment_events WHERE environment=? AND merchant=? AND ${request ? 'request_id=?' : "request_id IS NULL AND state='quarantined'"}`, request ? [environment, merchant, request.id] : [environment, merchant])
      if (count.n >= (request ? 100 : 250)) fail('Notification intake needs review. Please retry later.', 429)
      await tx.execute({ sql: 'INSERT INTO payment_events(id,environment,merchant,fingerprint,process_id,transaction_id,status_code,amount_agorot,state,request_id,supported) VALUES(?,?,?,?,?,?,?,?,?,?,?)', args: [eventId, environment, merchant, fingerprint, processId, transactionId, status, amount, request ? 'reported' : 'quarantined', request?.id ?? null, supported ? 1 : 0] })
      await tx.execute({ sql: 'INSERT INTO integration_payloads(id,ciphertext,expires_at) VALUES(?,?,?)', args: [eventId, encrypted, now() + 7 * DAY] })
      await tx.execute({ sql: "INSERT INTO integration_jobs(id,operation,event_id) VALUES(?,'verify',?)", args: [id(), eventId] })
      if (request) await tx.execute({ sql: "UPDATE students SET hold='Payment reported — check Grow before collecting again.' WHERE id=?", args: [request.student_id] })
      return { received: true }
    })
  }

  async function claimJob() {
    return transaction(db, async tx => {
      const job = await one(tx, `SELECT j.* FROM integration_jobs j JOIN payment_events e ON e.id=j.event_id WHERE e.environment=? AND e.merchant=? AND
        ((j.state='pending' AND j.next_attempt<=?) OR (j.state='running' AND j.lease_until<=?)) ORDER BY j.rowid LIMIT 1`, [environment, merchant, now(), now()])
      if (!job) return null
      // A reclaimed approval may already have reached Grow. Only replay after proving it safe.
      const state = job.operation === 'approve' && job.state === 'running' && !approvalReplaySafe ? 'needs_review' : 'running'
      await tx.execute({ sql: 'UPDATE integration_jobs SET state=?,generation=generation+1,attempts=attempts+1,lease_until=?,error=? WHERE id=?', args: [state, now() + 30_000, state === 'needs_review' ? 'Approval outcome unknown. Check Grow before replay.' : null, job.id] })
      return { ...job, state, attempts: job.attempts + 1, generation: job.generation + 1 }
    })
  }
  async function finish(job, state, error = null, retry = false) {
    await transaction(db, async tx => {
      const result = await tx.execute({ sql: 'UPDATE integration_jobs SET state=?,error=?,next_attempt=?,lease_until=0 WHERE id=? AND generation=? AND state=\'running\'', args: [state, error, now() + Math.min(60 * 60_000, 60_000 * 2 ** job.attempts), job.id, job.generation] })
      if (!result.rowsAffected) return
      if (state === 'done') await scheduleResolvedPayloads(tx, now())
      if (!retry && state === 'needs_review') await tx.execute({ sql: 'UPDATE integration_payloads SET purge_after=NULL WHERE id=?', args: [job.event_id] })
    })
  }
  async function runJobs() {
    const started = now()
    let processed = 0
    for (; processed < 4 && now() - started < 18_000; processed++) {
      const job = await claimJob()
      if (!job) break
      if (job.state !== 'running') continue
      const event = await one(db, 'SELECT * FROM payment_events WHERE id=?', [job.event_id])
      if (job.operation === 'verify') {
        // No documented authenticity check yet. Approval is acknowledgement, not verification.
        await finish(job, event.state === 'confirmed' ? 'done' : 'needs_review', event.state === 'confirmed' ? null : 'Check this transaction in Grow and confirm it in Billing.')
        continue
      }
      const payload = await one(db, 'SELECT * FROM integration_payloads WHERE id=?', [job.event_id])
      if (!payload?.ciphertext || payload.expires_at <= now()) {
        await finish(job, 'needs_review', 'Replay payload unavailable or expired. Reconcile in Grow.')
        continue
      }
      if (event.state !== 'confirmed' || !operationsUrl || !apiKey) {
        await finish(job, 'needs_review', 'Approval integration is not configured or payment is unconfirmed.')
        continue
      }
      let data
      try { data = await unseal(payload.ciphertext, payloadKey, payload.id) } catch {
        await finish(job, 'needs_review', 'Cannot decrypt approval payload. Restore the payload key.')
        continue
      }
      try {
        const response = await fetchImpl(operationsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-make-apikey': apiKey }, body: JSON.stringify({ version: 1, action: 'approve', jobId: job.id, data }), signal: AbortSignal.timeout(4000) })
        const body = await response.json()
        if (!response.ok || body?.version !== 1 || body.action !== 'approve' || body.jobId !== job.id || body.approved !== true) throw new Error('Approval outcome unknown')
        await finish(job, 'done')
      } catch {
        const retry = approvalReplaySafe && job.attempts < 5 && now() + 60_000 * 2 ** job.attempts < payload.expires_at
        await finish(job, retry ? 'pending' : 'needs_review', 'Approval did not return a confirmed result. Check Grow before replay.', retry)
      }
    }
    // Expiration never silently discards an unresolved payload.
    await transaction(db, async tx => {
      await tx.execute({ sql: "UPDATE integration_jobs SET state='needs_review',error='Replay payload expired. Reconcile in Grow.' WHERE state IN ('pending','running') AND event_id IN (SELECT id FROM integration_payloads WHERE expires_at<=?)", args: [now()] })
      const purge = await query(tx, `SELECT p.id FROM integration_payloads p WHERE p.ciphertext IS NOT NULL AND p.purge_after<=?
        AND NOT EXISTS(SELECT 1 FROM integration_jobs j WHERE j.event_id=p.id AND j.state!='done')`, [now()])
      for (const p of purge) await tx.execute({ sql: 'UPDATE integration_payloads SET ciphertext=NULL,purged_at=? WHERE id=?', args: [now(), p.id] })
    })
    return { processed }
  }
  return { receive, runJobs }
}
