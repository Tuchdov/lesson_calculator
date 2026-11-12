export const HEBREW_MONTHS = {
  1: 'ינואר', 2: 'פברואר', 3: 'מרץ', 4: 'אפריל',
  5: 'מאי', 6: 'יוני', 7: 'יולי', 8: 'אוגוסט',
  9: 'ספטמבר', 10: 'אוקטובר', 11: 'נובמבר', 12: 'דצמבר',
}

const LEGACY_LINK_PLACEHOLDER = '[קישור לתשלום]'

/**
 * "050-123-4567" → "972501234567" Israeli phone in the international form wa.me
 * expects.
 * @param {string} phone Phone as saved.
 * @returns {string} The number with 972 in place of the leading 0.
 */
export function formatPhoneForWhatsApp(phone) {
  const digits = phone.replace(/\D/g, '')
  return '972' + digits.slice(1)
}

/**
 * Israeli mobile: 05X + 7 digits (dashes/spaces allowed)
 * @param {string} phone Phone as typed.
 * @returns {boolean} Whether it is a valid mobile number.
 */
export function validateIsraeliPhone(phone) {
  return /^05[0-9]{8}$/.test(phone.replace(/[-\s]/g, ''))
}

export const DEFAULT_MESSAGE_TEMPLATE =
  `היי {first_name} :)\nהנה סיכום השיעורים שלך לחודש {month}:\n מספר שיעורים: {lessons}\n סה״כ לתשלום: ₪{amount}\n לתשלום: [קישור לתשלום]\nתודה ונתראה! `
/**
 * Substitutes {payer} and {student} (both are who pays: a parent, else the
 * student, so templates written when {student} held the payer keep working),
 * {first_name} (the payer's first word), {amount}, {month} and {lessons}.
 * @param {string} template The message template.
 * @param {object} values payerName, amount, monthName and lessons.
 * @returns {string} The message.
 */
export function renderMessageTemplate(template, { payerName, amount, monthName, lessons }) {
  const name = (payerName ?? '').replace(/[\r\n]+/g, ' ').trim()
  const firstName = name.split(/\s+/)[0]
  return (template ?? '')
    .replaceAll('{student}', name)
    .replaceAll('{payer}', name)
    .replaceAll('{first_name}', firstName)
    .replaceAll('{amount}', String(amount))
    .replaceAll('{month}', monthName ?? '')
    .replaceAll('{lessons}', String(lessons ?? ''))
}

/**
 * Places a payment link into an already-rendered message. Order: an explicit
 * {link} token wins; else the legacy dead-text placeholder is replaced (a saved
 * template from before this feature carries that literal text, not a token);
 * else the link is appended so it's never silently dropped.
 * @param {string} message The rendered message.
 * @param {string} [link] The payment link.
 * @returns {string} The message with the link.
 */
export function applyPaymentLink(message, link) {
  if (!link) return message
  if (message.includes('{link}')) return message.replaceAll('{link}', link)
  if (message.includes(LEGACY_LINK_PLACEHOLDER)) return message.split(LEGACY_LINK_PLACEHOLDER).join(link)
  return `${message}\n${link}`
}

/**
 * "YYYY-MM" → Hebrew month name (falls back to the raw string if unparseable).
 * @param {string} monthStr Month key.
 * @returns {string} The Hebrew month name.
 */
export function monthNameFromKey(monthStr) {
  const [, mm] = (monthStr ?? '').split('-')
  return HEBREW_MONTHS[parseInt(mm, 10)] ?? monthStr
}

/**
 * monthStr is "YYYY-MM"; template defaults to the built-in Hebrew message but
 * can be overridden with a user-customized template from settings. `lessons` is
 * the total lesson count for the student that month (optional — omitted
 * templates simply won't have a {lessons} token to replace). `link`, when
 * provided, replaces the placeholder/{link} token per applyPaymentLink above.
 * `payerName` is who the message greets (a child's parent, else the student).
 * The WhatsApp payment message. `lessons`
 * @param {string} payerName Who the message greets.
 * @param {number} amount Amount due.
 * @param {string} monthStr Month key.
 * @param {string} [template] Message template; the default by default.
 * @param {number} [lessons] Lesson count.
 * @param {string} [link] The payment link.
 * @returns {string} The message.
 */
export function buildPaymentMessage(payerName, amount, monthStr, template = DEFAULT_MESSAGE_TEMPLATE, lessons, link) {
  const rendered = renderMessageTemplate(template, { payerName, amount, monthName: monthNameFromKey(monthStr), lessons })
  return applyPaymentLink(rendered, link)
}

/**
 * A wa.me link that opens a chat with the message typed in.
 * @param {string} phone Phone as saved.
 * @param {string} message The message.
 * @returns {string} The URL.
 */
export function buildWhatsAppUrl(phone, message) {
  return `https://wa.me/${formatPhoneForWhatsApp(phone)}?text=${encodeURIComponent(message)}`
}
