import { sha256Hex } from './userSettings.js'
import { monthNameFromKey } from './whatsapp.js'
import { normalizeStudentName } from './calendarPayments.js'

const LINKS_KEY_PREFIX = 'vocalCalc:paymentLinks:'
const OVERRIDES_KEY_PREFIX = 'vocalCalc:amountOverrides:'
const REVIEW_KEY_PREFIX = 'vocalCalc:reviewResolutions:'
const TIER_KEY_PREFIX = 'vocalCalc:tierOverrides:'
const LESSON_OVERRIDES_KEY_PREFIX = 'vocalCalc:lessonOverrides:'
const EXCLUDED_KEY_PREFIX = 'vocalCalc:excludedStudents:'

/**
 * One invoice = one student for one month. Both the link store and the
 * amount-override store are keyed this way so neither carries a value into a
 * different month for the same student.
 * @param {string} month Month key of the invoice.
 * @param {string} student Student key.
 * @returns {string} "{month}:{student}".
 */
export function invoiceKey(month, student) {
  return `${month}:${student}`
}

/**
 * A row is keyed by the student's canonical saved name, which can change when
 * saved spellings change (calendarPayments.js resolveSavedStudent). So a
 * per-invoice record may sit under the row's own key, one of its other
 * spellings, or a name from an older parse that normalizes the same way.
 * Returns every name the month's record is stored under, the row's own key
 * first, so a reset can clear all of them. A row whose spellings conflict owns
 * only its own key. `suffix` addresses sub-records (review answers).
 * @param {object} record A per-invoice store, keyed `{month}:{student}`.
 * @param {string} month Month key of the invoice.
 * @param {object} row A calculated student row.
 * @param {string} [suffix] Sub-record suffix, e.g. `:{itemId}` for review
 *   answers.
 * @returns {string[]} Names with a record this month, the row's own first.
 */
export function invoiceRecordNames(record, month, row, suffix = '') {
  if (!record) return []
  const has = name => record[invoiceKey(month, name) + suffix] != null
  if (row.name_conflicts?.length) return has(row.student) ? [row.student] : []
  const names = [row.student, ...(row.aliases ?? [])].filter(has)
  const base = normalizeStudentName(row.student)
  for (const entry of monthEntries(record, month, suffix)) {
    if (entry.base === base && !names.includes(entry.name)) names.push(entry.name)
  }
  return names
}

// The names a month's record is stored under, with their normalized form.
// Every row asks for this on every render, and each save produces a new
// record object (withRecord), so the scan is kept per record object.
const entriesCache = new WeakMap()
/**
 * The names a month's record is stored under, cached per record object (see
 * entriesCache above).
 * @param {object} record A per-invoice store, keyed `{month}:{student}`.
 * @param {string} month Month key of the invoice.
 * @param {string} suffix Sub-record suffix.
 * @returns {Array<{name: string, base: string}>} Stored names and their
 *   normalized form.
 */
function monthEntries(record, month, suffix) {
  let byMonth = entriesCache.get(record)
  if (!byMonth) entriesCache.set(record, byMonth = new Map())
  const id = `${month}\u0000${suffix}`
  let entries = byMonth.get(id)
  if (!entries) {
    entries = []
    const prefix = `${month}:`
    for (const [key, value] of Object.entries(record)) {
      if (value == null || !key.startsWith(prefix) || !key.endsWith(suffix)) continue
      const name = key.slice(prefix.length, key.length - suffix.length)
      if (name) entries.push({ name, base: normalizeStudentName(name) })
    }
    byMonth.set(id, entries)
  }
  return entries
}

/**
 * The name the row's record for the month is stored under (its own key first).
 * @param {object} record A per-invoice store, keyed `{month}:{student}`.
 * @param {string} month Month key of the invoice.
 * @param {object} row A calculated student row.
 * @param {string} [suffix] Sub-record suffix, e.g. `:{itemId}` for review
 *   answers.
 * @returns {string | null} The name, or null when there is no record.
 */
export function invoiceRecordName(record, month, row, suffix = '') {
  return invoiceRecordNames(record, month, row, suffix)[0] ?? null
}

/**
 * The row's record for the month, under whichever spelling holds it.
 * @param {object} record A per-invoice store, keyed `{month}:{student}`.
 * @param {string} month Month key of the invoice.
 * @param {object} row A calculated student row.
 * @param {string} [suffix] Sub-record suffix, e.g. `:{itemId}` for review
 *   answers.
 * @returns {* | null} The stored value, or null.
 */
export function invoiceRecord(record, month, row, suffix = '') {
  const name = invoiceRecordName(record, month, row, suffix)
  return name == null ? null : record[invoiceKey(month, name) + suffix]
}

// --- Phone ------------------------------------------------------------

/**
 * "050-1234567" / "050 1234567" → "0501234567", the format Grow's Phone field
 * expects. Phone is persisted raw with dashes (EditableTable.jsx), unlike
 * formatPhoneForWhatsApp which needs the 972-prefixed form.
 * @param {string} phone Phone as saved.
 * @returns {string} Digits only.
 */
export function normalizePhoneForGrow(phone) {
  return (phone ?? '').replace(/\D/g, '')
}

// --- Full name ----------------------------------------------------------

/**
 * Grow's Full Name field requires a first and last name, each 2+ characters.
 * normalizeStudentName (calendarPayments.js) can return a single word, which
 * Grow rejects — this flags that case before a send is attempted.
 * @param {string} name The payer name.
 * @returns {boolean} Whether Grow will accept it.
 */
export function hasFullName(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2 && parts.every(p => p.length >= 2)
}

// --- Amount --------------------------------------------------------------

/**
 * Whether an amount can be billed: a finite number above 0.
 * @param {*} amount The amount due.
 * @returns {boolean} Whether it is valid.
 */
export function isValidAmount(amount) {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
}

/**
 * A minted link belongs to the amount it was minted for (decision 6). Amounts
 * are compared in agorot (cents) to avoid floating-point drift on repeated
 * rounding.
 * @param {number} storedAmount Amount the link was minted for.
 * @param {number} currentAmount Amount due now.
 * @returns {boolean} Whether they differ.
 */
export function amountChanged(storedAmount, currentAmount) {
  return Math.round(storedAmount * 100) !== Math.round(currentAmount * 100)
}

// --- Make payment profile ------------------------------------------------------

// What the Make scenario's Router treats as the default route; the server
// (paymentLinkService.js) sends it when a student has no profile.
export const DEFAULT_PAYMENT_PROFILE = 'standard'
// The Router's routes, offered on the Custom Prices page. Make sends anything
// other than 'extended' (any case) to the standard route; the labels mirror the
// Grow methods each route's module is set up with in Make.
export const PAYMENT_PROFILES = [
  { id: DEFAULT_PAYMENT_PROFILE, label: 'Standard: card, Apple Pay, Google Pay, bank transfer' },
  { id: 'extended', label: 'Extended: all methods, including Bit and Paybox' },
]
// Grow's product line; the server rejects longer rendered invoice text.
export const MAX_INVOICE_DESCRIPTION = 200

// Profile names are what the Router matches on, so they stay short single
// tokens (Hebrew allowed). Checked on the Custom Prices page and the server.
const PAYMENT_PROFILE_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u

/**
 * Whether a payment profile name is a short single token the Make Router can
 * match.
 * @param {string} profile The profile name.
 * @returns {boolean} Whether it is valid.
 */
export function isValidPaymentProfile(profile) {
  return PAYMENT_PROFILE_PATTERN.test(profile)
}

// --- Grow payment description ---------------------------------------------

/**
 * A short Hebrew description naming the month, shown on Grow's payment page. A
 * per-student template (e.g. "ייעוץ קולי - {student} - {month}") replaces the
 * default wording; it is collapsed to one line for Grow's field.
 * @param {string} studentName The student, for {student}.
 * @param {string} monthStr Month key.
 * @param {string} [template] Per-student template.
 * @returns {string} The one-line description.
 */
export function buildGrowDescription(studentName, monthStr, template) {
  const monthName = monthNameFromKey(monthStr)
  if (!template) return `תשלום עבור שיעורי שירה - ${studentName} - ${monthName}`
  // One pass, so a name that itself contains "{month}" is not substituted again.
  const values = { student: studentName ?? '', month: monthName ?? '' }
  return template
    .replace(/\{(student|month)\}/g, (_, token) => values[token])
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The invoice text a student's link is minted with: their own text, else the
 * Settings default, else '' (the server's built-in wording).
 * @param {object} details The student's saved details.
 * @param {string} defaultTemplate The Settings default.
 * @returns {string} The template, or "".
 */
export function invoiceTemplateFor(details, defaultTemplate) {
  return details?.invoice_description?.trim() || defaultTemplate?.trim() || ''
}

// Month names don't depend on the year, so any year lists the 12 of them.
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => `2000-${String(i + 1).padStart(2, '0')}`)

/**
 * The server checks the rendered text, so a template only fits Grow's field if
 * it fits in the month with the longest name.
 * @param {string} studentName The student.
 * @param {string} template The invoice template.
 * @returns {boolean} Whether it fits every month.
 */
export function fitsInvoiceLimit(studentName, template) {
  return ALL_MONTHS.every(m => buildGrowDescription(studentName, m, template).length <= MAX_INVOICE_DESCRIPTION)
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

/**
 * Parses a stored record; missing or corrupt data reads as empty.
 * @param {string} key Storage key.
 * @param {Storage} storage Where it is stored.
 * @returns {object} The record.
 */
function readRecord(key, storage) {
  const raw = storage.getItem(key)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Queues a read-modify-write of one stored record (see the section comment
 * above).
 * @param {string} key Storage key.
 * @param {Storage} storage Where it is stored.
 * @param {Function} mutate Changes the record in place.
 * @returns {Promise<object>} The record after the change.
 */
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

/**
 * Load every saved payment link for an account.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} Links keyed by `{month}:{student}`.
 */
export async function loadPaymentLinks(email, storage = globalThis.localStorage) {
  const key = LINKS_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

/**
 * `inputs` is linkInputs() for what the link was minted with, so a later change
 * to the payer, phone, profile or invoice text makes it stale.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {string} month Month key of the invoice.
 * @param {string} student Student name the record is saved under.
 * @param {string} link The payment link.
 * @param {number} amount Amount it was minted for.
 * @param {string} [inputs] linkInputs() fingerprint.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} All links after the change.
 */
export async function savePaymentLink(email, month, student, link, amount, inputs, storage = globalThis.localStorage) {
  const key = LINKS_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    all[invoiceKey(month, student)] = inputs ? { link, amount, inputs } : { link, amount }
  })
}

/**
 * Everything besides the amount that shapes a minted link. Blank optional
 * fields are dropped, so a link from before fingerprints existed (minted with
 * the defaults) still matches a student who uses the defaults.
 * @param {object} fields payerName, phone, lessonStudent, paymentProfile and
 *   invoiceDescription.
 * @returns {string} A JSON fingerprint.
 */
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

/**
 * A stored link is reusable only if it was minted for the amount currently due
 * (decision 5) and with the same payer, phone, profile and invoice text. Looked
 * up under every spelling of the row's student (invoiceRecord). A link saved
 * before fingerprints existed stays usable while the student still uses the
 * default profile and invoice text. Its payer is unknown (main minted it with
 * the saved full name, else the student), and treating that as stale would mint
 * a second live link for an invoice that may already be sent.
 * @param {object | null} entry The saved link.
 * @param {number} currentAmount Amount due now.
 * @param {string} [currentInputs] linkInputs() for the row now.
 * @returns {boolean} Whether the link can be sent.
 */
export function isEntryUsable(entry, currentAmount, currentInputs) {
  if (!entry || amountChanged(entry.amount, currentAmount)) return false
  if (!currentInputs) return true
  if (entry.inputs) return entry.inputs === currentInputs
  const { profile, invoice } = JSON.parse(currentInputs)
  return !profile && !invoice
}

/**
 * Whether the row's saved link for the month can be sent as is (isEntryUsable).
 * @param {object} links Saved links.
 * @param {string} month Month key of the invoice.
 * @param {object} row A calculated student row.
 * @param {number} currentAmount Amount due now.
 * @param {string} [currentInputs] linkInputs() for the row now.
 * @returns {boolean} Whether the link can be sent.
 */
export function isLinkUsable(links, month, row, currentAmount, currentInputs) {
  return isEntryUsable(invoiceRecord(links, month, row), currentAmount, currentInputs)
}

// --- Amount override store -------------------------------------------------
// vocalCalc:amountOverrides:<hash>, keyed by {month}:{student} (decision 6).
// Lives outside customer_details, which has no month dimension and would
// carry a one-off adjustment into every later month.

/**
 * Load every saved amount override for an account.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} Amounts keyed by `{month}:{student}`.
 */
export async function loadAmountOverrides(email, storage = globalThis.localStorage) {
  const key = OVERRIDES_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

/**
 * Passing amount = null clears the override for that invoice (reset to the
 * calculated amount).
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {string} month Month key of the invoice.
 * @param {string} student Student name the record is saved under.
 * @param {number | null} amount The amount due, or null to clear.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} All overrides after the change.
 */
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

/**
 * Load every saved review answer for an account.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} Answers keyed by `{month}:{student}:{eventId}`.
 */
export async function loadReviewResolutions(email, storage = globalThis.localStorage) {
  const key = REVIEW_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

/**
 * Save, or clear with null, the answer for one review item.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {string} itemKey rowPricing.js reviewKey.
 * @param {object | null} resolution {mode, amount?}, or null.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} All answers after the change.
 */
export async function saveReviewResolution(email, itemKey, resolution, storage = globalThis.localStorage) {
  const key = REVIEW_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    if (resolution == null) delete all[itemKey]
    else all[itemKey] = resolution
  })
}

// --- Price tier override store ----------------------------------------------
// vocalCalc:tierOverrides:<hash>, keyed by {month}:{student}. Value is the
// tier the teacher chose for that invoice ('regular' = discounted price),
// e.g. a discount granted although the student didn't qualify this month.
// Per month like the amount overrides, so it never carries into a later one.

/**
 * Load every saved price-tier choice for an account.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} Tiers keyed by `{month}:{student}`.
 */
export async function loadTierOverrides(email, storage = globalThis.localStorage) {
  const key = TIER_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

/**
 * Passing tier = null clears the override (back to the calculated tier).
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {string} month Month key of the invoice.
 * @param {string} student Student name the record is saved under.
 * @param {string | null} tier "regular", or null to clear.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} All tier choices after the change.
 */
export async function saveTierOverride(email, month, student, tier, storage = globalThis.localStorage) {
  const key = TIER_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    const k = invoiceKey(month, student)
    if (tier == null) delete all[k]
    else all[k] = tier
  })
}

// --- Lesson count override store --------------------------------------------
// vocalCalc:lessonOverrides:<hash>, keyed by {month}:{student} like the amount
// overrides. Value is { '60': n, '45': n, '30': n }, the counts that replace
// the calendar's for that invoice (rowPricing.js applyLessonOverride); null
// clears it.

/**
 * Load every saved lesson-count override for an account.
 * @param {string} email The signed-in user's email, hashed into the storage key.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<Record<string, { '60': number, '45': number, '30': number }>>}
 *   Overrides keyed by `{month}:{student}`.
 */
export async function loadLessonOverrides(email, storage = globalThis.localStorage) {
  const key = LESSON_OVERRIDES_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

/**
 * Save, or clear, the lesson counts for one student's invoice in a month.
 * @param {string} email The signed-in user's email, hashed into the storage key.
 * @param {string} month Month key of the invoice.
 * @param {string} student Student name the override is saved under.
 * @param {{ '60': number, '45': number, '30': number } | null} counts The
 *   replacement counts, or null/undefined to remove the override.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<Record<string, object>>} All overrides after the change.
 */
export async function saveLessonOverride(email, month, student, counts, storage = globalThis.localStorage) {
  const key = LESSON_OVERRIDES_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    const k = invoiceKey(month, student)
    if (counts == null) delete all[k]
    else all[k] = counts
  })
}

// --- Excluded student store --------------------------------------------------
// vocalCalc:excludedStudents:<hash>, keyed by {month}:{student}. A student
// left out of one month's invoices (table, total, CSV, Prepare all) without
// touching anything saved for them; true excludes, null restores.

/**
 * Load every student left out of a month, for an account.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} true keyed by `{month}:{student}`.
 */
export async function loadExcludedStudents(email, storage = globalThis.localStorage) {
  const key = EXCLUDED_KEY_PREFIX + await sha256Hex(email)
  return readRecord(key, storage)
}

/**
 * Leave a student out of a month, or (excluded false) bring them back.
 * @param {string} email The signed-in user's email, hashed into the storage
 *   key.
 * @param {string} month Month key of the invoice.
 * @param {string} student Student name the record is saved under.
 * @param {boolean} excluded Whether to leave them out.
 * @param {Storage} [storage] Defaults to localStorage.
 * @returns {Promise<object>} All exclusions after the change.
 */
export async function saveExcludedStudent(email, month, student, excluded, storage = globalThis.localStorage) {
  const key = EXCLUDED_KEY_PREFIX + await sha256Hex(email)
  return withRecord(key, storage, (all) => {
    const k = invoiceKey(month, student)
    if (!excluded) delete all[k]
    else all[k] = true
  })
}
