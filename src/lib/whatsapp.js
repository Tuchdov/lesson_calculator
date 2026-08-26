export const HEBREW_MONTHS = {
  1: 'ינואר', 2: 'פברואר', 3: 'מרץ', 4: 'אפריל',
  5: 'מאי', 6: 'יוני', 7: 'יולי', 8: 'אוגוסט',
  9: 'ספטמבר', 10: 'אוקטובר', 11: 'נובמבר', 12: 'דצמבר',
}

const LEGACY_LINK_PLACEHOLDER = '[קישור לתשלום]'

// "050-123-4567" → "972501234567"
export function formatPhoneForWhatsApp(phone) {
  const digits = phone.replace(/\D/g, '')
  return '972' + digits.slice(1)
}

// Israeli mobile: 05X + 7 digits (dashes/spaces allowed)
export function validateIsraeliPhone(phone) {
  return /^05[0-9]{8}$/.test(phone.replace(/[-\s]/g, ''))
}

export const DEFAULT_MESSAGE_TEMPLATE =
  ` שלום {student} :)\nהנה סיכום השיעורים שלך לחודש {month}:\n מספר שיעורים: {lessons}\n סה״כ לתשלום: ₪{amount}\n לתשלום: [קישור לתשלום]\nתודה ונתראה! `

// Substitutes {student}, {amount}, {month}, {lessons} tokens into a user-editable template.
export function renderMessageTemplate(template, { studentName, amount, monthName, lessons }) {
  const safeName = (studentName ?? '').replace(/[\r\n]+/g, ' ').trim()
  return (template ?? '')
    .replaceAll('{student}', safeName)
    .replaceAll('{amount}', String(amount))
    .replaceAll('{month}', monthName ?? '')
    .replaceAll('{lessons}', String(lessons ?? ''))
}

// Places a payment link into an already-rendered message. Order: an explicit
// {link} token wins; else the legacy dead-text placeholder is replaced (a
// saved template from before this feature carries that literal text, not a
// token); else the link is appended so it's never silently dropped.
export function applyPaymentLink(message, link) {
  if (!link) return message
  if (message.includes('{link}')) return message.replaceAll('{link}', link)
  if (message.includes(LEGACY_LINK_PLACEHOLDER)) return message.split(LEGACY_LINK_PLACEHOLDER).join(link)
  return `${message}\n${link}`
}

// "YYYY-MM" → Hebrew month name (falls back to the raw string if unparseable).
export function monthNameFromKey(monthStr) {
  const [, mm] = (monthStr ?? '').split('-')
  return HEBREW_MONTHS[parseInt(mm, 10)] ?? monthStr
}

// monthStr is "YYYY-MM"; template defaults to the built-in Hebrew message but
// can be overridden with a user-customized template from settings. `lessons`
// is the total lesson count for the student that month (optional — omitted
// templates simply won't have a {lessons} token to replace). `link`, when
// provided, replaces the placeholder/{link} token per applyPaymentLink above.
export function buildPaymentMessage(studentName, amount, monthStr, template = DEFAULT_MESSAGE_TEMPLATE, lessons, link) {
  const rendered = renderMessageTemplate(template, { studentName, amount, monthName: monthNameFromKey(monthStr), lessons })
  return applyPaymentLink(rendered, link)
}

export function buildWhatsAppUrl(phone, message) {
  return `https://wa.me/${formatPhoneForWhatsApp(phone)}?text=${encodeURIComponent(message)}`
}
