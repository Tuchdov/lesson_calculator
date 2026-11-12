export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min early

/**
 * When a token expires.
 * @param {number | string} expiresInSeconds Google's expires_in.
 * @param {number} [now] Current time in ms.
 * @returns {number} Expiry time in ms.
 */
export function computeExpiresAt(expiresInSeconds, now = Date.now()) {
  return now + Number(expiresInSeconds) * 1000
}

/**
 * Whether a token is expired or about to be.
 * @param {number} expiresAt Expiry time in ms.
 * @param {number} [bufferMs] How early to treat it as expired.
 * @param {number} [now] Current time in ms.
 * @returns {boolean} Whether to refresh it.
 */
export function isTokenExpired(expiresAt, bufferMs = TOKEN_EXPIRY_BUFFER_MS, now = Date.now()) {
  if (!expiresAt) return true
  return now >= expiresAt - bufferMs
}
