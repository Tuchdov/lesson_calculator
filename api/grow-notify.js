import { endpoint, requireSecret, runtime } from '../server/billingRuntime.js'

export default endpoint(['POST'], async req => {
  // Direct Grow delivery remains unverified; forwarding authenticates that hop only.
  const authenticated = !!process.env.MAKE_NOTIFY_SECRET
  if (authenticated || req.headers['x-make-notify-secret'] !== undefined) requireSecret(req, 'MAKE_NOTIFY_SECRET', 'x-make-notify-secret')
  const { events } = await runtime()
  return events.receive(req.body, { authenticated })
})
