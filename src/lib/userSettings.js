const KEY_PREFIX = 'vocalCalc:settings:'
// paid_cancellation_phrases/cancelled_keywords use `null` (not `[]`) to mean
// "never customized, fall back to the built-in default list" — an explicit
// `[]` means the user intentionally cleared the list, which must be
// distinguishable from "not customized yet" everywhere these are read.
const DEFAULT_SETTINGS = { custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '', paid_cancellation_phrases: null, cancelled_keywords: null }

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function loadUserSettings(email, storage = globalThis.localStorage) {
  const key = KEY_PREFIX + await sha256Hex(email)
  const raw = storage.getItem(key)
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveUserSettings(email, settings, storage = globalThis.localStorage) {
  const key = KEY_PREFIX + await sha256Hex(email)
  storage.setItem(key, JSON.stringify(settings))
}
