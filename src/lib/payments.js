import { sha256Hex } from './userSettings.js'
import { monthNameFromKey } from './whatsapp.js'
import { normalizeStudentName } from './calendarPayments.js'

const LINKS_KEY_PREFIX = 'vocalCalc:paymentLinks:'
const OVERRIDES_KEY_PREFIX = 'vocalCalc:amountOverrides:'
const REVIEW_KEY_PREFIX = 'vocalCalc:reviewResolutions:'

// One invoice = one student for one month. Both the link store and the
// amount-override store are keyed this way so neither carries a value into
// a different month for the same student.
export function invoiceKey(month, student) {
  return `${month}:${student}`
}

// A row is keyed by the student's canonical saved name, which can change when
// saved spellings change (calendarPayments.js resolveSavedStudent). So a
// per-invoice record may sit under the row's own key, one of its other
// spellings, or a name from an older parse that normalizes the same way.
// Returns every name the month's record is stored under, the row's own key
// first, so a reset can clear all of them. A row whose spellings conflict
// owns only its own key. `suffix` addresses sub-records (review answers).
export function invoiceRecordNames(record, month, row, suffix = '') {
  if (!record) return []
  const has = name => record[invoiceKey(month, name) + suffix] != null
  if (row.name_conflicts?.length) return has(row.student) ? [row.student] : []
  const names = [row.student, ...(row.aliases ?? [])].filter(has)
  const base = normalizeStudentName(row.student)
  const prefix = `${month}:`
  for (const [key, value] of Object.entries(record)) {
    if (value == null || !key.startsWith(prefix) || !key.endsWith(suffix)) continue
    const name = key.slice(prefix.length, key.length - suffix.length)
    if (name && !names.includes(name) && normalizeStudentName(name) === base) names.push(name)
  }
  return names
}

export function invoiceRecordName(record, month, row, suffix = '') {
  return invoiceRecordNames(record, month, row, suffix)[0] ?? null
}

export function invoiceRecord(record, month, row, suffix = '') {
  const name = invoiceRecordName(record, month, row, suffix)
  return name == null ? null : record[invoiceKey(month, name) + suffix]
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

// --- Make payment profile ------------------------------------------------------

// What the Make scenario's Router treats as the default route; shared by the
// server (paymentLinkService.js) and the Custom Prices suggestions.
export const DEFAULT_PAYMENT_PROFILE = 'standard'
// Grow's product line; the server rejects longer rendered invoice text.
export const MAX_INVOICE_DESCRIPTION = 200

// Profile names are what the Router matches on, so they stay short single
// tokens (Hebrew allowed). Checked on the Custom Prices page and the server.
const PAYMENT_PROFILE_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u

export function isValidPaymentProfile(profile) {
  return PAYMENT_PROFILE_PATTERN.test(profile)
}

// --- Grow payment description ---------------------------------------------

// A short Hebrew description naming the month, shown on Grow's payment page.
// A per-student template (e.g. "ייעוץ קולי - {student} - {month}") replaces
// the default wording; it is collapsed to one line for Grow's field.
export function buildGrowDescription(studentName, monthStr, template) {
  const monthName = monthNameFromKey(monthStr)
  if (!template) return `תשלום עבור שיעורי שירה - ${studentName} - ${monthName}`
  return template
    .replaceAll('{student}', () => studentName ?? '')
    .replaceAll('{month}', () => monthName ?? '')
    .replace(/\s+/g, ' ')
    .trim()
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

// `inputs` is linkInputs() for what the link was minted with, so a later change
// to the payer, phone, profile or invoice text makes it stale.
export async function savePaymentLink(email, month, student, link, amount, inputs, storage = globalThis.localStorage) {
  const key = LINKS_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    all[invoiceKey(month, student)] = inputs ? { link, amount, inputs } : { link, amount }
  })
}

// Everything besides the amount that shapes a minted link. Blank optional
// fields are dropped, so a link from before fingerprints existed (minted with
// the defaults) still matches a student who uses the defaults.
export function linkInputs({ payerName, phone, lessonStudent, paymentProfile, invoiceDescription }) {
  const fields = {
    payer: (payerName ?? '').trim(),
    phone: normalizePhoneForGrow(phone),
    student: (lessonStudent ?? '').trim(),
    profile: (paymentProfile ?? '').trim(),
    invoice: (invoiceDescription ?? '').trim(),
  }
  if (!fields.profile || fields.profile === DEFAULT_PAYMENT_PROFILE) delete fields.profile
  if (!fields.invoice) delete fields.invoice
  return JSON.stringify(fields)
}

// A stored link is reusable only if it was minted for the amount currently
// due (decision 5) and with the same payer, phone, profile and invoice text.
// Looked up under every spelling of the row's student (invoiceRecord). A link
// saved before fingerprints existed stays usable while the student still uses
// the default profile and invoice text. Its payer is unknown (main minted it
// with the saved full name, else the student), and treating that as stale
// would mint a second live link for an invoice that may already be sent.
export function isEntryUsable(entry, currentAmount, currentInputs) {
  if (!entry || amountChanged(entry.amount, currentAmount)) return false
  if (!currentInputs) return true
  if (entry.inputs) return entry.inputs === currentInputs
  const { profile, invoice } = JSON.parse(currentInputs)
  return !profile && !invoice
}

export function isLinkUsable(links, month, row, currentAmount, currentInputs) {
  return isEntryUsable(invoiceRecord(links, month, row), currentAmount, currentInputs)
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

// --- Review resolution store ------------------------------------------------
// vocalCalc:reviewResolutions:<hash>, keyed by {month}:{student}:{eventId}
// (rowPricing.js reviewKey). Value is { mode: 'prorata' | 'base' | 'fixed' |
// 'free', amount? }; null clears it.

export async function loadReviewResolutions(email, storage = globalThis.localStorage) {
  const key = REVIEW_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

export async function saveReviewResolution(email, itemKey, resolution, storage = globalThis.localStorage) {
  const key = REVIEW_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    if (resolution == null) delete all[itemKey]
    else all[itemKey] = resolution
  })
}
