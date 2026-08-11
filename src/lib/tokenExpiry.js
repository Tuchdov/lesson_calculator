export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min early

export function computeExpiresAt(expiresInSeconds, now = Date.now()) {
  return now + Number(expiresInSeconds) * 1000
}

export function isTokenExpired(expiresAt, bufferMs = TOKEN_EXPIRY_BUFFER_MS, now = Date.now()) {
  if (!expiresAt) return true
  return now >= expiresAt - bufferMs
}
