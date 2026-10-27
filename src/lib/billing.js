export function validateMonth(month) {
  return typeof month === 'string' && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)
}

export function toAgorot(value) {
  const text = String(value).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter an amount with at most two decimal places.')
  const amount = Math.round(Number(text) * 100)
  if (!Number.isSafeInteger(amount) || amount > 100_000_000) throw new Error('Amount is too large.')
  return amount
}

export function formatMoney(agorot) {
  return (agorot / 100).toFixed(2)
}

export function normalizeAlias(name) {
  return typeof name === 'string' ? name.normalize('NFC').trim().replace(/\s+/g, ' ') : ''
}

export function billingStatus(student) {
  if (!student) return 'Status unavailable'
  if (student.pending?.length) return 'Payment reported — verify'
  if (student.hold) return 'Needs review'
  if (!student.invoices.length) return 'Not saved'
  if (!student.remainingAgorot) return 'Paid'
  if (student.paidAgorot > 0) return 'Partially paid'
  return 'Unpaid'
}
