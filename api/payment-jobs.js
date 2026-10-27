import { endpoint, requireSecret, runtime } from '../server/billingRuntime.js'

export default endpoint(['POST'], async req => {
  requireSecret(req, 'PAYMENT_JOBS_SECRET', 'x-payment-jobs-secret')
  const { events } = await runtime()
  return events.runJobs()
})
