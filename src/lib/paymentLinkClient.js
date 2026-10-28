import { billingRequest } from './billingClient.js'

// Browser-side call to /api/create-payment-link. Thin on purpose — the real
// logic (auth, Make call, response validation) lives in
// src/api/paymentLinkService.js and is covered by deno test there; this
// wrapper is glue that only a running app can exercise.
export async function requestPaymentLink(getAccessToken, { studentName, phone, amount, month }) {
  const token = await getAccessToken()
  const res = await fetch('/api/create-payment-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ studentName, phone, amount, month }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`)
    err.retryable = !!body.retryable
    err.status = res.status
    throw err
  }
  return body.link
}

export async function requestPaymentLinks(getAccessToken, items, owner) {
  const body = await billingRequest(getAccessToken, '/api/create-payment-link', { items }, { owner })
  if (!Array.isArray(body.results) || body.results.length !== items.length) throw new Error('Invalid batch response')
  return body.results
}
