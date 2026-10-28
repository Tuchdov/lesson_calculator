import { ServiceError } from './serviceError.js'
import { callMakeWebhook } from './paymentLinkService.js'
import { normalizePhoneForGrow, hasFullName, buildGrowDescription } from '../lib/payments.js'
import { validateIsraeliPhone } from '../lib/whatsapp.js'

export async function prepareDurableLink(repository, owner, input, { webhookUrl, apiKey, fetchImpl = fetch }) {
  if (typeof input?.studentName !== 'string' || input.studentName.length > 160 || !hasFullName(input.studentName)) throw new ServiceError(400, 'Enter a full customer name.')
  if (!validateIsraeliPhone(input.phone)) throw new ServiceError(400, 'Invalid phone number.')
  if (!webhookUrl || !apiKey) throw new ServiceError(503, 'Payment integration is not configured.')
  const request = await repository.claimRequest(owner, input)
  if (!request.dispatch) return { id: request.id, state: request.state, link: request.state === 'ready' ? request.url : null, amountAgorot: request.amount_agorot }
  try {
    const result = await callMakeWebhook({ webhookUrl, apiKey, fetchImpl, payload: {
      version: 1, request_id: request.id, amount_agorot: request.amount_agorot,
      billing_reference: request.id,
      customer_name: input.studentName, phone: normalizePhoneForGrow(input.phone),
      amount: request.amount_agorot / 100, description: buildGrowDescription(input.studentName, input.month),
    } })
    const saved = await repository.completeRequest(request.id, { ...result, amountAgorot: request.amount_agorot })
    if (saved.state !== 'ready') throw new ServiceError(409, 'Conflicting payment result. Review this request in Grow.')
    return { id: request.id, state: 'ready', link: result.link, amountAgorot: request.amount_agorot }
  } catch {
    // Even an invalid result may follow a successful provider creation.
    await repository.unknownRequest(request.id)
    throw new ServiceError(409, 'Payment result is uncertain. Refresh Billing or resolve this request in Grow; do not create another link.')
  }
}

export async function prepareDurableBatch(repository, owner, items, options) {
  if (!Array.isArray(items) || !items.length || items.length > 40) throw new ServiceError(400, 'Provide 1–40 payment requests.')
  const results = []
  const now = options.now ?? Date.now
  const deadline = now() + 35_000 // Leave time for the last 12s call, auth and DB work.
  let index = 0
  async function worker() {
    while (index < items.length) {
      const i = index++
      if (now() >= deadline) {
        results[i] = { state: 'deferred', retryable: true, error: 'Batch paused before the server deadline. Refresh and prepare the remaining students.' }
        continue
      }
      try { results[i] = await prepareDurableLink(repository, owner, items[i], options) } catch (error) {
        results[i] = { error: error instanceof ServiceError ? error.message : 'Request needs review.', state: 'error' }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, 6) }, worker))
  return { results }
}
