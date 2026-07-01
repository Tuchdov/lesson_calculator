const KEY_PREFIX = 'vocalCalc:settings:'
const DEFAULT_SETTINGS = { custom_prices: {}, customer_details: {} }

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
