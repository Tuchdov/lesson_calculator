import { sha256Hex } from './userSettings.js'

export async function billingRequest(getAccessToken, path, body, { signal, owner } = {}) {
  if (!owner) throw new Error('Sign in to load Billing.')
  const token = await getAccessToken()
  if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError')
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', signal,
    headers: { Authorization: `Bearer ${token}`, 'X-Billing-Owner': owner, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Billing request failed (${response.status}).`)
  return data
}

// Persist before network dispatch. A new tab with another ID is still protected
// by the server's active request constraint, which is the final authority.
export async function durableRequestId(owner, input, storage = globalThis.localStorage) {
  const key = `vocalCalc:billingRequest:${await sha256Hex(JSON.stringify([owner, input]))}`
  const previous = storage.getItem(key)
  if (previous) return previous
  const requestId = crypto.randomUUID()
  storage.setItem(key, requestId)
  return requestId
}

export async function paymentInput(owner, student, month, details) {
  const input = { studentId: student.id, month, revision: student.revision, studentName: details.full_name || student.name, phone: details.phone }
  return { ...input, requestId: await durableRequestId(owner, input) }
}
