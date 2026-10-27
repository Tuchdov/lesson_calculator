import { caller, endpoint, runtime } from '../server/billingRuntime.js'
import { prepareDurableLink, prepareDurableBatch } from '../src/api/durablePaymentService.js'

export default endpoint(['POST'], async req => {
  const owner = await caller(req) // Exactly once for the whole batch.
  const { repository, options } = await runtime()
  return Array.isArray(req.body?.items)
    ? prepareDurableBatch(repository, owner, req.body.items, options)
    : prepareDurableLink(repository, owner, req.body, options)
})
