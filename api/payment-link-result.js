import { endpoint, requireSecret, runtime } from '../server/billingRuntime.js'

export default endpoint(['POST'], async req => {
  requireSecret(req, 'MAKE_RESULT_SECRET', 'x-make-result-secret')
  const { repository } = await runtime()
  return repository.completeRequest(req.body?.requestId, req.body ?? {})
})
