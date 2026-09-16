import { isValidAmount, normalizePhoneForGrow, buildGrowDescription } from '../lib/payments.js'
import { validateIsraeliPhone } from '../lib/whatsapp.js'

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'

// Carries an HTTP status and a retryable flag through to the thin Vercel
// adapter, so the UI can tell "sign in again" apart from "try again".
export class ServiceError extends Error {
  constructor(status, message, { retryable = false } = {}) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

// Identity is read from Google's answer, never from the request body — the
// caller cannot claim to be anyone by changing what it sends.
async function verifyCaller(accessToken, { allowedEmail, clientId, fetchImpl }) {
  if (!accessToken) throw new ServiceError(401, 'Sign in again.')

  let res
  try {
    res = await fetchImpl(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`)
  } catch {
    throw new ServiceError(503, 'Could not reach Google. Try again.', { retryable: true })
  }

  let data
  try {
    data = await res.json()
  } catch {
    throw new ServiceError(401, 'Sign in again.')
  }

  if (!res.ok || !data.email || !data.aud) {
    throw new ServiceError(401, 'Sign in again.')
  }

  const expiresIn = Number(data.expires_in)
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new ServiceError(401, 'Sign in again.')
  }

  if (data.aud !== clientId) {
    throw new ServiceError(403, 'Not authorized.')
  }

  if (data.email !== allowedEmail) {
    throw new ServiceError(403, 'Not authorized.')
  }
}

// Confirmed against the live Make scenario (T1): the webhook expects
// {customer_name, amount, phone, description} and, on success, returns
// {status: 1, err: {}, data: {paymentLinkProcessId, paymentLinkProcessToken,
// url}}. Grow's amount is shekels, sent as-is — no agorot conversion.
async function callMakeWebhook({ webhookUrl, apiKey, payload, fetchImpl }) {
  let res
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) headers['x-make-apikey'] = apiKey
    res = await fetchImpl(webhookUrl, { method: 'POST', headers, body: JSON.stringify(payload) })
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
  if (typeof link !== 'string' || !link.startsWith('https://')) {
    throw new ServiceError(502, 'The payment service did not return a link. Try again.', { retryable: true })
  }

  return link
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

  if (!isValidAmount(amount)) {
    throw new ServiceError(400, 'Invalid amount.')
  }

  if (!phone || !validateIsraeliPhone(phone)) {
    throw new ServiceError(400, 'Invalid phone number.')
  }

  if (!webhookUrl) {
    throw new ServiceError(500, 'Payment service is not configured.')
  }

  const link = await callMakeWebhook({
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
