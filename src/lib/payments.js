import { sha256Hex } from './userSettings.js'
import { monthNameFromKey } from './whatsapp.js'

const LINKS_KEY_PREFIX = 'vocalCalc:paymentLinks:'
const OVERRIDES_KEY_PREFIX = 'vocalCalc:amountOverrides:'

// One invoice = one student for one month. Both the link store and the
// amount-override store are keyed this way so neither carries a value into
// a different month for the same student.
export function invoiceKey(month, student) {
  return `${month}:${student}`
}

// --- Phone ------------------------------------------------------------

// "050-1234567" / "050 1234567" → "0501234567", the format Grow's Phone
// field expects. Phone is persisted raw with dashes (EditableTable.jsx),
// unlike formatPhoneForWhatsApp which needs the 972-prefixed form.
export function normalizePhoneForGrow(phone) {
  return (phone ?? '').replace(/\D/g, '')
}

// --- Full name ----------------------------------------------------------

// Grow's Full Name field requires a first and last name, each 2+ characters.
// normalizeStudentName (calendarPayments.js) can return a single word, which
// Grow rejects — this flags that case before a send is attempted.
export function hasFullName(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2 && parts.every(p => p.length >= 2)
}

// --- Amount --------------------------------------------------------------

export function isValidAmount(amount) {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
}

// A minted link belongs to the amount it was minted for (decision 6). Amounts
// are compared in agorot (cents) to avoid floating-point drift on repeated
// rounding.
export function amountChanged(storedAmount, currentAmount) {
  return Math.round(storedAmount * 100) !== Math.round(currentAmount * 100)
}

// --- Grow payment description ---------------------------------------------

// A short Hebrew description naming the month, shown on Grow's payment page.
export function buildGrowDescription(studentName, monthStr) {
  return `תשלום עבור שיעורי שירה - ${studentName} - ${monthNameFromKey(monthStr)}`
}

// --- Shared hashed-record storage ------------------------------------------
// Both stores below are "prefix + sha256Hex(email) -> JSON blob", the same
// shape as userSettings.js. Reads are a plain parse; writes go through
// withRecord, which chains all writes to the same key on one promise per
// key so concurrent callers (e.g. "Prepare all links" minting 6 links at
// once) can't interleave a read-modify-write and silently drop each other's
// entry — the earlier per-call read-modify-write did exactly that under
// real concurrency, not just on a crash.

const writeQueues = new Map()

function readRecord(key, storage) {
  const raw = storage.getItem(key)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function withRecord(key, storage, mutate) {
  const queued = (writeQueues.get(key) ?? Promise.resolve()).then(() => {
    const all = readRecord(key, storage)
    mutate(all)
    storage.setItem(key, JSON.stringify(all))
    return all
  })
  // Swallow so a failed write doesn't permanently wedge the queue for this
  // key; the caller still sees the rejection via the returned `queued`.
  writeQueues.set(key, queued.catch(() => {}))
  return queued
}

// --- Payment link store ---------------------------------------------------
// vocalCalc:paymentLinks:<hash>, NOT in the settings blob (decision 4).
// Written per link as it arrives so an interrupted "prepare all" run keeps
// every link that already landed.

export async function loadPaymentLinks(email, storage = globalThis.localStorage) {
  const key = LINKS_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

export async function savePaymentLink(email, month, student, link, amount, storage = globalThis.localStorage) {
  const key = LINKS_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    all[invoiceKey(month, student)] = { link, amount }
  })
}

export function getStoredLink(links, month, student) {
  return links?.[invoiceKey(month, student)] ?? null
}

// A stored link is reusable only if it was minted for the amount currently
// due (decision 5, amount-only invalidation).
export function isLinkUsable(links, month, student, currentAmount) {
  const entry = getStoredLink(links, month, student)
  return !!entry && !amountChanged(entry.amount, currentAmount)
}

// --- Amount override store -------------------------------------------------
// vocalCalc:amountOverrides:<hash>, keyed by {month}:{student} (decision 6).
// Lives outside customer_details, which has no month dimension and would
// carry a one-off adjustment into every later month.

export async function loadAmountOverrides(email, storage = globalThis.localStorage) {
  const key = OVERRIDES_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

// Passing amount = null clears the override for that invoice (reset to the
// calculated amount).
export async function saveAmountOverride(email, month, student, amount, storage = globalThis.localStorage) {
  const key = OVERRIDES_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    const k = invoiceKey(month, student)
    if (amount == null) delete all[k]
    else all[k] = amount
  })
}

export function getStoredOverride(overrides, month, student) {
  return overrides?.[invoiceKey(month, student)] ?? null
}
