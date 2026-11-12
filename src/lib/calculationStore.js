import { sha256Hex } from './userSettings.js'

// vocalCalc:calculation:<hash>, the last calculated table per account, so
// closing the site doesn't lose it. Everything edited on the table (links,
// prices, lesson counts, overrides) already lives in its own store and is
// applied on top when it comes back.
const CALCULATION_KEY_PREFIX = 'vocalCalc:calculation:'

/**
 * Load the account's last calculation.
 * @param {string} email The signed-in user's email, hashed into the storage key.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<{rows: Array, summary: object, calculatedWith: object|null} | null>}
 *   The saved calculation, or null when there is none or it is unreadable.
 */
export async function loadCalculation(email, storage = globalThis.localStorage) {
  const raw = storage.getItem(CALCULATION_KEY_PREFIX + await sha256Hex(email))
  if (!raw) return null
  try {
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved?.rows) || typeof saved?.summary?.month !== 'string') return null
    return { rows: saved.rows, summary: saved.summary, calculatedWith: saved.calculatedWith ?? null }
  } catch {
    return null
  }
}

/**
 * Save the account's current calculation, replacing the previous one.
 * @param {string} email The signed-in user's email, hashed into the storage key.
 * @param {{rows: Array, summary: object, calculatedWith: object|null}} calculation The table to keep.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<void>}
 */
export async function saveCalculation(email, { rows, summary, calculatedWith }, storage = globalThis.localStorage) {
  const key = CALCULATION_KEY_PREFIX + await sha256Hex(email)
  storage.setItem(key, JSON.stringify({ rows, summary, calculatedWith: calculatedWith ?? null }))
}
