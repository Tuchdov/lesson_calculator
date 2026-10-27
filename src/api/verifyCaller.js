import { ServiceError } from './serviceError.js'

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'

export async function verifyCaller(accessToken, { allowedEmail, clientId, fetchImpl = fetch }) {
  if (!accessToken) throw new ServiceError(401, 'Sign in again.')

  let res
  try {
    res = await fetchImpl(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(5000) })
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
  return data.email
}
