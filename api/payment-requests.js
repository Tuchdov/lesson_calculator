import { caller, endpoint, runtime } from '../server/billingRuntime.js'

export default endpoint(['GET'], async req => {
  const owner = await caller(req)
  const { repository } = await runtime()
  return repository.getRequest(owner, req.query?.id)
})
