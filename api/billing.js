import { caller, endpoint, runtime } from '../server/billingRuntime.js'
import { ServiceError } from '../src/api/serviceError.js'

export default endpoint(['GET', 'POST'], async req => {
  const owner = await caller(req)
  const { repository } = await runtime()
  if (req.method === 'GET') return repository.getBilling(owner, req.query?.month)
  const actions = {
    saveMonth: repository.saveMonth,
    recordManual: repository.recordManual,
    confirmEvent: repository.confirmEvent,
    resolveEvent: repository.resolveEvent,
    resolveApproval: repository.resolveApproval,
    closeRequest: repository.closeRequest,
    reversePayment: repository.reversePayment,
    adjustInvoice: repository.adjustInvoice,
    addAlias: repository.addAlias,
    openingBalance: repository.openingBalance,
    importLegacy: repository.importLegacy,
    resolveLegacy: repository.resolveLegacy,
  }
  if (!Object.hasOwn(actions, req.body?.action)) throw new ServiceError(400, 'Unknown billing action.')
  return actions[req.body.action](owner, req.body)
})
