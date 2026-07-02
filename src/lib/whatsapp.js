const HEBREW_MONTHS = {
  1: 'ינואר', 2: 'פברואר', 3: 'מרץ', 4: 'אפריל',
  5: 'מאי', 6: 'יוני', 7: 'יולי', 8: 'אוגוסט',
  9: 'ספטמבר', 10: 'אוקטובר', 11: 'נובמבר', 12: 'דצמבר',
}

// "050-123-4567" → "972501234567"
export function formatPhoneForWhatsApp(phone) {
  const digits = phone.replace(/\D/g, '')
  return '972' + digits.slice(1)
}

// Israeli mobile: 05X + 7 digits (dashes/spaces allowed)
export function validateIsraeliPhone(phone) {
  return /^05[0-9]{8}$/.test(phone.replace(/[-\s]/g, ''))
}

// monthStr is "YYYY-MM"
export function buildPaymentMessage(studentName, amount, monthStr) {
  const [, mm] = (monthStr ?? '').split('-')
  const monthName = HEBREW_MONTHS[parseInt(mm, 10)] ?? monthStr
  const safeName = (studentName ?? '').replace(/[\r\n]+/g, ' ').trim()
  return  ` שלום ${safeName} :)\nהנה סיכום השיעורים שלך לחודש ${monthName}:\n סה״כ לתשלום: ₪${amount}\n לתשלום: [קישור לתשלום]\nתודה ונתראה! `
}

export function buildWhatsAppUrl(phone, message) {
  return `https://wa.me/${formatPhoneForWhatsApp(phone)}?text=${encodeURIComponent(message)}`
}
