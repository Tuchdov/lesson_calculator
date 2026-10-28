import { isValidAmount, normalizePhoneForGrow, buildGrowDescription } from '../lib/payments.js'
import { validateIsraeliPhone } from '../lib/whatsapp.js'

import { ServiceError } from './serviceError.js'
import { verifyCaller } from './verifyCaller.js'
export { ServiceError } from './serviceError.js'

// Confirmed against the live Make scenario (T1): the webhook expects
// {customer_name, amount, phone, description} and, on success, returns
// {status: 1, err: {}, data: {paymentLinkProcessId, paymentLinkProcessToken,
// url}}. Grow's amount is shekels, sent as-is — no agorot conversion.
export async function callMakeWebhook({ webhookUrl, apiKey, payload, fetchImpl }) {
  let res
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) headers['x-make-apikey'] = apiKey
    res = await fetchImpl(webhookUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) })
  } catch {
    throw new ServiceError(502, 'Could not reach the payment service. Try again.', { retryable: true })
  }

  if (!res.ok) {
    throw new ServiceError(502, 'The payment service returned an error. Try again.', { retryable: true })
  }

  let body
  try {
    body = await res.json()
  } catch {
    throw new ServiceError(502, 'The payment service returned an unexpected response. Try again.', { retryable: true })
  }

  const link = body?.data?.url
  if (String(body?.status) !== '1' || typeof link !== 'string' || !link.startsWith('https://')) {
    throw new ServiceError(502, 'The payment service did not return a link. Try again.', { retryable: true })
  }

  return { link, processId: String(body.data.paymentLinkProcessId ?? ''), processToken: body.data.paymentLinkProcessToken ?? '' }
}

// month is "YYYY-MM", used only to build the Hebrew description shown on
// Grow's payment page — callers must pass summary.month, never a live month
// input (see CalculatorPage.jsx / design decision 12).
export async function createPaymentLink({
  accessToken,
  studentName,
  phone,
  amount,
  month,
  allowedEmail,
  clientId,
  webhookUrl,
  apiKey,
  fetchImpl = fetch,
}) {
  await verifyCaller(accessToken, { allowedEmail, clientId, fetchImpl })
  return createVerifiedLink({ studentName, phone, amount, month, webhookUrl, apiKey, fetchImpl })
}

async function createVerifiedLink({ studentName, phone, amount, month, webhookUrl, apiKey, fetchImpl }) {
  if (!isValidAmount(amount)) {
    throw new ServiceError(400, 'Invalid amount.')
  }

  if (!phone || !validateIsraeliPhone(phone)) {
    throw new ServiceError(400, 'Invalid phone number.')
  }

  if (!webhookUrl) {
    throw new ServiceError(500, 'Payment service is not configured.')
  }

  const { link } = await callMakeWebhook({
    webhookUrl,
    apiKey,
    payload: {
      customer_name: studentName,
      amount,
      phone: normalizePhoneForGrow(phone),
      description: buildGrowDescription(studentName, month),
    },
    fetchImpl,
  })

  return { link }
}

// Authenticate once, then keep each item's failure independent.
export async function createPaymentLinks({ items, accessToken, allowedEmail, clientId, webhookUrl, apiKey, fetchImpl = fetch }) {
  await verifyCaller(accessToken, { allowedEmail, clientId, fetchImpl })
  if (!Array.isArray(items) || items.length < 1 || items.length > 40) {
    throw new ServiceError(400, 'Provide between 1 and 40 payment requests.')
  }
  const results = new Array(items.length)
  let index = 0
  async function worker() {
    while (index < items.length) {
      const i = index++
      try {
        results[i] = await createVerifiedLink({ ...items[i], webhookUrl, apiKey, fetchImpl })
      } catch (err) {
        results[i] = { error: err instanceof ServiceError ? err.message : 'Unexpected server error.', retryable: !!err.retryable }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker))
  return { results }
}
