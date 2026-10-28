import { timingSafeEqual } from 'node:crypto'
import { createDatabase, one } from '../src/api/db.js'
import { createBillingRepository } from '../src/api/billingRepository.js'
import { createPaymentEvents } from '../src/api/paymentEvents.js'
import { ServiceError } from '../src/api/serviceError.js'
import { verifyCaller } from '../src/api/verifyCaller.js'

let database
export function config() {
  const env = process.env
  return {
    mode: env.BILLING_MODE || 'shadow', environment: env.GROW_ENVIRONMENT, merchant: env.GROW_MERCHANT_ID,
    payloadKey: env.PAYMENT_PAYLOAD_KEY, operationsUrl: env.MAKE_OPERATIONS_WEBHOOK_URL, apiKey: env.MAKE_API_KEY,
    webhookUrl: env.MAKE_WEBHOOK_URL, approvalReplaySafe: env.GROW_APPROVAL_REPLAY_SAFE === 'true',
  }
}
export async function runtime() {
  database ??= createDatabase({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  let version
  try { version = await one(database, 'SELECT MAX(version) AS version FROM schema_migrations') } catch {
    throw new ServiceError(503, 'Run the billing database migrations before using Billing.')
  }
  if (version?.version !== 2) throw new ServiceError(503, 'Unsupported billing database version. Run the billing database migrations.')
  const options = config()
  const control = await one(database, 'SELECT environment,merchant FROM billing_control WHERE id=1')
  if (control?.environment !== options.environment || control?.merchant !== options.merchant) throw new ServiceError(503, 'Billing database belongs to another environment/merchant or has not been configured.')
  return { repository: createBillingRepository(database, options), events: createPaymentEvents(database, options), options }
}

export async function caller(req) {
  const authorization = req.headers.authorization || ''
  const owner = await verifyCaller(authorization.startsWith('Bearer ') ? authorization.slice(7) : null, {
    allowedEmail: process.env.ALLOWED_EMAIL, clientId: process.env.VITE_GOOGLE_CLIENT_ID,
  })
  const expectedOwner = req.headers['x-billing-owner']
  if (expectedOwner !== undefined && expectedOwner !== owner) throw new ServiceError(409, 'Account changed. Reload Billing before continuing.')
  return owner
}

export function requireSecret(req, environmentName, headerName) {
  const expected = process.env[environmentName]
  if (!expected || expected.length < 32) throw new ServiceError(503, 'Integration authentication is not configured.')
  const actual = req.headers[headerName]
  if (typeof actual !== 'string' || actual.length > 1000) throw new ServiceError(401, 'Invalid integration credentials.')
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ServiceError(401, 'Invalid integration credentials.')
}

export function endpoint(methods, work) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '))
      return res.status(405).json({ error: 'Method not allowed' })
    }
    try {
      return res.status(200).json(await work(req))
    } catch (err) {
      return res.status(err instanceof ServiceError ? err.status : 500).json({ error: err instanceof ServiceError ? err.message : 'Billing could not complete this action. Refresh or review its status before retrying.', retryable: !!err.retryable })
    }
  }
}
