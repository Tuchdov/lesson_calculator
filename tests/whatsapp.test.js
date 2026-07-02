import { assertEquals, assertMatch } from '@std/assert'
import {
  validateIsraeliPhone,
  formatPhoneForWhatsApp,
  buildPaymentMessage,
  buildWhatsAppUrl,
  renderMessageTemplate,
  DEFAULT_MESSAGE_TEMPLATE,
} from '../src/lib/whatsapp.js'

// ── validateIsraeliPhone ──────────────────────────────────────────────────────

Deno.test('validateIsraeliPhone: accepts 10-digit 05X numbers', () => {
  assertEquals(validateIsraeliPhone('0501234567'), true)
  assertEquals(validateIsraeliPhone('0521234567'), true)
  assertEquals(validateIsraeliPhone('0541234567'), true)
  assertEquals(validateIsraeliPhone('0581234567'), true)
})

Deno.test('validateIsraeliPhone: accepts dashes and spaces', () => {
  assertEquals(validateIsraeliPhone('050-1234567'), true)
  assertEquals(validateIsraeliPhone('050 123 4567'), true)
  assertEquals(validateIsraeliPhone('054-765-4321'), true)
})

Deno.test('validateIsraeliPhone: rejects wrong length', () => {
  assertEquals(validateIsraeliPhone('050123456'), false)   // 9 digits
  assertEquals(validateIsraeliPhone('05012345678'), false) // 11 digits
})

Deno.test('validateIsraeliPhone: rejects non-mobile prefixes', () => {
  assertEquals(validateIsraeliPhone('0401234567'), false) // 04 is landline
  assertEquals(validateIsraeliPhone('0721234567'), false) // 07 is not mobile
  assertEquals(validateIsraeliPhone('0001234567'), false)
})

Deno.test('validateIsraeliPhone: rejects letters and garbage', () => {
  assertEquals(validateIsraeliPhone('abc'), false)
  assertEquals(validateIsraeliPhone(''), false)
  assertEquals(validateIsraeliPhone('+972501234567'), false) // international format not accepted
})

// ── formatPhoneForWhatsApp ────────────────────────────────────────────────────

Deno.test('formatPhoneForWhatsApp: strips leading 0 and prepends 972', () => {
  assertEquals(formatPhoneForWhatsApp('0501234567'), '972501234567')
  assertEquals(formatPhoneForWhatsApp('0521234567'), '972521234567')
})

Deno.test('formatPhoneForWhatsApp: strips dashes before converting', () => {
  assertEquals(formatPhoneForWhatsApp('050-123-4567'), '972501234567')
  assertEquals(formatPhoneForWhatsApp('054-765-4321'), '972547654321')
})

Deno.test('formatPhoneForWhatsApp: strips spaces before converting', () => {
  assertEquals(formatPhoneForWhatsApp('050 123 4567'), '972501234567')
})

// ── buildPaymentMessage ───────────────────────────────────────────────────────

Deno.test('buildPaymentMessage: includes student name', () => {
  const msg = buildPaymentMessage('רחל', 350, '2026-06')
  assertMatch(msg, /רחל/)
})

Deno.test('buildPaymentMessage: includes Hebrew month name', () => {
  const months = {
    '2026-01': 'ינואר', '2026-02': 'פברואר', '2026-03': 'מרץ',
    '2026-04': 'אפריל', '2026-05': 'מאי',   '2026-06': 'יוני',
    '2026-07': 'יולי',  '2026-08': 'אוגוסט', '2026-09': 'ספטמבר',
    '2026-10': 'אוקטובר', '2026-11': 'נובמבר', '2026-12': 'דצמבר',
  }
  for (const [monthStr, hebrewName] of Object.entries(months)) {
    const msg = buildPaymentMessage('Test', 100, monthStr)
    assertMatch(msg, new RegExp(hebrewName), `Expected "${hebrewName}" in message for ${monthStr}`)
  }
})

Deno.test('buildPaymentMessage: includes amount', () => {
  const msg = buildPaymentMessage('דוד', 420, '2026-07')
  assertMatch(msg, /420/)
  assertMatch(msg, /₪420/)
})

Deno.test('buildPaymentMessage: includes payment link placeholder', () => {
  const msg = buildPaymentMessage('מיכל', 300, '2026-07')
  assertMatch(msg, /\[קישור לתשלום\]/)
})

// ── buildWhatsAppUrl ──────────────────────────────────────────────────────────

Deno.test('buildWhatsAppUrl: starts with wa.me and correct number', () => {
  const url = buildWhatsAppUrl('050-1234567', 'hello')
  assertMatch(url, /^https:\/\/wa\.me\/972501234567/)
})

Deno.test('buildWhatsAppUrl: URL-encodes the message', () => {
  const url = buildWhatsAppUrl('0501234567', 'שלום עולם')
  assertMatch(url, /\?text=/)
  // encoded Hebrew won't appear raw in the URL
  assertEquals(url.includes('שלום'), false)
})

Deno.test('buildPaymentMessage: null monthStr falls back gracefully', () => {
  // monthStr ?? '' → '' → split('-') → ['', undefined] → parseInt(undefined) = NaN → fallback is monthStr (null)
  // The message should still contain the student name and amount without crashing
  const msg = buildPaymentMessage('Test', 100, null)
  assertMatch(msg, /Test/)
  assertMatch(msg, /100/)
})

Deno.test('buildPaymentMessage: undefined monthStr falls back gracefully', () => {
  const msg = buildPaymentMessage('Test', 100, undefined)
  assertMatch(msg, /Test/)
  assertMatch(msg, /100/)
})

Deno.test('formatPhoneForWhatsApp: empty string yields 972 with empty suffix', () => {
  // Edge: no digits → digits = '' → slice(1) = '' → '972'
  assertEquals(formatPhoneForWhatsApp(''), '972')
})

// ── renderMessageTemplate / custom templates ─────────────────────────────────

Deno.test('renderMessageTemplate: substitutes all three tokens', () => {
  const msg = renderMessageTemplate('Hi {student}, you owe ₪{amount} for {month}', {
    studentName: 'Alice', amount: 250, monthName: 'June',
  })
  assertEquals(msg, 'Hi Alice, you owe ₪250 for June')
})

Deno.test('renderMessageTemplate: repeated tokens all get replaced', () => {
  const msg = renderMessageTemplate('{student}! {student}, pay ₪{amount}', {
    studentName: 'Bob', amount: 100, monthName: 'July',
  })
  assertEquals(msg, 'Bob! Bob, pay ₪100')
})

Deno.test('renderMessageTemplate: sanitizes newlines in student name', () => {
  const msg = renderMessageTemplate('{student}', { studentName: 'Alice\nEvil', amount: 1, monthName: 'July' })
  assertEquals(msg, 'Alice Evil')
})

Deno.test('buildPaymentMessage: custom template overrides the default', () => {
  const msg = buildPaymentMessage('Alice', 250, '2026-06', 'Hi {student}, ₪{amount} due {month}')
  assertEquals(msg, 'Hi Alice, ₪250 due יוני')
})

Deno.test('buildPaymentMessage: no template falls back to DEFAULT_MESSAGE_TEMPLATE', () => {
  const msg = buildPaymentMessage('Alice', 250, '2026-06')
  assertMatch(msg, /Alice/)
  assertMatch(msg, /250/)
})

Deno.test('buildWhatsAppUrl: full round-trip produces valid URL', () => {
  const phone = '054-7654321'
  const msg = buildPaymentMessage('רחל כהן', 350, '2026-06')
  const url = buildWhatsAppUrl(phone, msg)
  const parsed = new URL(url)
  assertEquals(parsed.hostname, 'wa.me')
  assertEquals(parsed.pathname, '/972547654321')
  assertMatch(parsed.searchParams.get('text') ?? '', /רחל כהן/)
  assertMatch(parsed.searchParams.get('text') ?? '', /יוני/)
  assertMatch(parsed.searchParams.get('text') ?? '', /₪350/)
})
