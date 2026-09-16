import { assertEquals } from '@std/assert'
import {
  invoiceKey,
  normalizePhoneForGrow,
  hasFullName,
  isValidAmount,
  amountChanged,
  buildGrowDescription,
  loadPaymentLinks,
  savePaymentLink,
  getStoredLink,
  isLinkUsable,
  loadAmountOverrides,
  saveAmountOverride,
  getStoredOverride,
} from '../src/lib/payments.js'
import { sha256Hex } from '../src/lib/userSettings.js'

function makeStub() {
  const map = new Map()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
}

// ── invoiceKey ──────────────────────────────────────────────────────────────

Deno.test('invoiceKey: combines month and student', () => {
  assertEquals(invoiceKey('2026-08', 'רחל כהן'), '2026-08:רחל כהן')
})

// ── normalizePhoneForGrow ────────────────────────────────────────────────────

Deno.test('normalizePhoneForGrow: strips dashes', () => {
  assertEquals(normalizePhoneForGrow('050-1234567'), '0501234567')
})

Deno.test('normalizePhoneForGrow: strips spaces', () => {
  assertEquals(normalizePhoneForGrow('050 123 4567'), '0501234567')
})

Deno.test('normalizePhoneForGrow: leaves an already-clean number untouched', () => {
  assertEquals(normalizePhoneForGrow('0501234567'), '0501234567')
})

Deno.test('normalizePhoneForGrow: does not prepend 972 (unlike formatPhoneForWhatsApp)', () => {
  assertEquals(normalizePhoneForGrow('050-1234567'), '0501234567')
})

Deno.test('normalizePhoneForGrow: null/undefined yields empty string', () => {
  assertEquals(normalizePhoneForGrow(null), '')
  assertEquals(normalizePhoneForGrow(undefined), '')
})

// ── hasFullName ──────────────────────────────────────────────────────────────

Deno.test('hasFullName: true for two words, each 2+ characters', () => {
  assertEquals(hasFullName('רחל כהן'), true)
  assertEquals(hasFullName('Dana Levy'), true)
})

Deno.test('hasFullName: false for a single word', () => {
  assertEquals(hasFullName('אחינועם'), false)
})

Deno.test('hasFullName: false when a word is a single character', () => {
  assertEquals(hasFullName('ר כהן'), false)
})

Deno.test('hasFullName: false for empty/null/undefined', () => {
  assertEquals(hasFullName(''), false)
  assertEquals(hasFullName(null), false)
  assertEquals(hasFullName(undefined), false)
})

Deno.test('hasFullName: true for three or more words', () => {
  assertEquals(hasFullName('רותם בן עצמון'), true)
})

// ── isValidAmount ────────────────────────────────────────────────────────────

Deno.test('isValidAmount: true for a positive finite number', () => {
  assertEquals(isValidAmount(487.5), true)
  assertEquals(isValidAmount(1), true)
})

Deno.test('isValidAmount: false for zero, negative, NaN, Infinity, non-numbers', () => {
  assertEquals(isValidAmount(0), false)
  assertEquals(isValidAmount(-50), false)
  assertEquals(isValidAmount(NaN), false)
  assertEquals(isValidAmount(Infinity), false)
  assertEquals(isValidAmount('487.5'), false)
  assertEquals(isValidAmount(null), false)
  assertEquals(isValidAmount(undefined), false)
})

// ── amountChanged ────────────────────────────────────────────────────────────

Deno.test('amountChanged: false when amounts are identical', () => {
  assertEquals(amountChanged(487.5, 487.5), false)
})

Deno.test('amountChanged: false when amounts differ only by floating-point drift', () => {
  assertEquals(amountChanged(0.1 + 0.2, 0.3), false)
})

Deno.test('amountChanged: true when amounts differ by a cent', () => {
  assertEquals(amountChanged(487.5, 487.51), true)
})

Deno.test('amountChanged: true when amounts differ substantially', () => {
  assertEquals(amountChanged(300, 450), true)
})

// ── buildGrowDescription ─────────────────────────────────────────────────────

Deno.test('buildGrowDescription: includes the student name', () => {
  const desc = buildGrowDescription('רחל כהן', '2026-08')
  assertEquals(desc.includes('רחל כהן'), true)
})

Deno.test('buildGrowDescription: includes the Hebrew month name', () => {
  const desc = buildGrowDescription('רחל כהן', '2026-08')
  assertEquals(desc.includes('אוגוסט'), true)
})

// ── payment link store ───────────────────────────────────────────────────────

Deno.test('loadPaymentLinks: returns empty object when key absent', async () => {
  const stub = makeStub()
  const links = await loadPaymentLinks('user@example.com', stub)
  assertEquals(links, {})
})

Deno.test('savePaymentLink + loadPaymentLinks: round-trips one entry', async () => {
  const stub = makeStub()
  await savePaymentLink('user@example.com', '2026-08', 'רחל כהן', 'https://pay.grow.link/abc', 487.5, stub)
  const links = await loadPaymentLinks('user@example.com', stub)
  assertEquals(links, { '2026-08:רחל כהן': { link: 'https://pay.grow.link/abc', amount: 487.5 } })
})

Deno.test('savePaymentLink: writing a second link preserves the first (crash-safe batch writes)', async () => {
  const stub = makeStub()
  await savePaymentLink('user@example.com', '2026-08', 'Alice', 'https://pay.grow.link/a', 300, stub)
  await savePaymentLink('user@example.com', '2026-08', 'Bob', 'https://pay.grow.link/b', 450, stub)
  const links = await loadPaymentLinks('user@example.com', stub)
  assertEquals(Object.keys(links).length, 2)
  assertEquals(links['2026-08:Alice'].link, 'https://pay.grow.link/a')
  assertEquals(links['2026-08:Bob'].link, 'https://pay.grow.link/b')
})

Deno.test('savePaymentLink: same student, different months, do not collide', async () => {
  const stub = makeStub()
  await savePaymentLink('user@example.com', '2026-07', 'Alice', 'https://pay.grow.link/july', 300, stub)
  await savePaymentLink('user@example.com', '2026-08', 'Alice', 'https://pay.grow.link/aug', 450, stub)
  const links = await loadPaymentLinks('user@example.com', stub)
  assertEquals(links['2026-07:Alice'].amount, 300)
  assertEquals(links['2026-08:Alice'].amount, 450)
})

// Regression guard for a code-review finding: "Prepare all links" fires
// several savePaymentLink calls concurrently (PREPARE_CONCURRENCY = 6 in
// CalculatorPage.jsx). Without serializing writes to the same storage key,
// two concurrent read-modify-writes can interleave and one overwrites the
// other's entry — exactly the "lost link" failure the crash-safety design
// was meant to prevent, just moved from the crash boundary to the
// concurrency boundary.
Deno.test('savePaymentLink: concurrent writes to different students do not clobber each other', async () => {
  const stub = makeStub()
  const students = Array.from({ length: 10 }, (_, i) => `Student${i}`)
  await Promise.all(students.map((student, i) =>
    savePaymentLink('user@example.com', '2026-08', student, `https://pay.grow.link/${i}`, 100 + i, stub)
  ))
  const links = await loadPaymentLinks('user@example.com', stub)
  assertEquals(Object.keys(links).length, students.length)
  for (let i = 0; i < students.length; i++) {
    assertEquals(links[`2026-08:${students[i]}`], { link: `https://pay.grow.link/${i}`, amount: 100 + i })
  }
})

Deno.test('saveAmountOverride: concurrent writes to different students do not clobber each other', async () => {
  const stub = makeStub()
  const students = Array.from({ length: 10 }, (_, i) => `Student${i}`)
  await Promise.all(students.map((student, i) =>
    saveAmountOverride('user@example.com', '2026-08', student, 100 + i, stub)
  ))
  const overrides = await loadAmountOverrides('user@example.com', stub)
  assertEquals(Object.keys(overrides).length, students.length)
  for (let i = 0; i < students.length; i++) {
    assertEquals(overrides[`2026-08:${students[i]}`], 100 + i)
  }
})

Deno.test('loadPaymentLinks: returns empty object when stored JSON is corrupt', async () => {
  const stub = makeStub()
  const key = 'vocalCalc:paymentLinks:' + await sha256Hex('user@example.com')
  stub.setItem(key, '{ not valid json')
  const links = await loadPaymentLinks('user@example.com', stub)
  assertEquals(links, {})
})

Deno.test('getStoredLink: returns the entry for a month:student key, or null', () => {
  const links = { '2026-08:Alice': { link: 'https://x', amount: 300 } }
  assertEquals(getStoredLink(links, '2026-08', 'Alice'), { link: 'https://x', amount: 300 })
  assertEquals(getStoredLink(links, '2026-08', 'Bob'), null)
  assertEquals(getStoredLink(null, '2026-08', 'Bob'), null)
})

Deno.test('isLinkUsable: true when a link exists and the amount is unchanged', () => {
  const links = { '2026-08:Alice': { link: 'https://x', amount: 300 } }
  assertEquals(isLinkUsable(links, '2026-08', 'Alice', 300), true)
})

Deno.test('isLinkUsable: false when the amount changed since the link was minted', () => {
  const links = { '2026-08:Alice': { link: 'https://x', amount: 300 } }
  assertEquals(isLinkUsable(links, '2026-08', 'Alice', 350), false)
})

Deno.test('isLinkUsable: false when no link is stored for that invoice', () => {
  assertEquals(isLinkUsable({}, '2026-08', 'Alice', 300), false)
})

// ── amount override store ────────────────────────────────────────────────────

Deno.test('loadAmountOverrides: returns empty object when key absent', async () => {
  const stub = makeStub()
  const overrides = await loadAmountOverrides('user@example.com', stub)
  assertEquals(overrides, {})
})

Deno.test('saveAmountOverride + loadAmountOverrides: round-trips one entry', async () => {
  const stub = makeStub()
  await saveAmountOverride('user@example.com', '2026-08', 'Alice', 350, stub)
  const overrides = await loadAmountOverrides('user@example.com', stub)
  assertEquals(overrides, { '2026-08:Alice': 350 })
})

Deno.test('saveAmountOverride: passing null clears the override', async () => {
  const stub = makeStub()
  await saveAmountOverride('user@example.com', '2026-08', 'Alice', 350, stub)
  await saveAmountOverride('user@example.com', '2026-08', 'Alice', null, stub)
  const overrides = await loadAmountOverrides('user@example.com', stub)
  assertEquals(overrides, {})
})

Deno.test('saveAmountOverride: an override does not carry into a different month', async () => {
  const stub = makeStub()
  await saveAmountOverride('user@example.com', '2026-03', 'Alice', 350, stub)
  const overrides = await loadAmountOverrides('user@example.com', stub)
  assertEquals(getStoredOverride(overrides, '2026-03', 'Alice'), 350)
  assertEquals(getStoredOverride(overrides, '2026-04', 'Alice'), null)
})

Deno.test('loadAmountOverrides: returns empty object when stored JSON is corrupt', async () => {
  const stub = makeStub()
  const key = 'vocalCalc:amountOverrides:' + await sha256Hex('user@example.com')
  stub.setItem(key, 'not json at all')
  const overrides = await loadAmountOverrides('user@example.com', stub)
  assertEquals(overrides, {})
})

Deno.test('getStoredOverride: returns null when overrides object itself is null', () => {
  assertEquals(getStoredOverride(null, '2026-08', 'Alice'), null)
})
