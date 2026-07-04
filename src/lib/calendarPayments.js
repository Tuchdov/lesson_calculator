const REQUIRED_LESSON_PHRASE = 'פיתוח קול'
export const DEFAULT_PAID_CANCELLATION_PHRASES = ['ביטול בתשלום']
const DEFAULT_CANCELLED_KEYWORDS = ['cancelled', 'canceled', 'cancel', 'בוטל', 'מבוטל']

export function monthWindow(monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = month === 12
    ? new Date(Date.UTC(year + 1, 0, 1))
    : new Date(Date.UTC(year, month, 1))
  return { start, end }
}

export function lessonDurationMinutes(event) {
  const startRaw = event?.start?.dateTime
  const endRaw = event?.end?.dateTime
  if (!startRaw || !endRaw) return null

  const diffMin = Math.round((new Date(endRaw) - new Date(startRaw)) / 60000)
  if (diffMin === 30 || diffMin === 45 || diffMin === 60) return diffMin
  if (diffMin >= 27 && diffMin <= 33) return 30
  if (diffMin >= 42 && diffMin <= 48) return 45
  if (diffMin >= 57 && diffMin <= 63) return 60
  return null
}

// Detects a single calendar block that covers two back-to-back lessons booked
// as one event (e.g. a 120-min block instead of two separate 60-min events).
// Returns the half-duration (45 or 60) so the caller can count it twice, or
// null if the event isn't a recognized double-length block.
export function doubleLessonDurationMinutes(event) {
  const startRaw = event?.start?.dateTime
  const endRaw = event?.end?.dateTime
  if (!startRaw || !endRaw) return null

  const diffMin = Math.round((new Date(endRaw) - new Date(startRaw)) / 60000)
  if (diffMin >= 87 && diffMin <= 93) return 45
  if (diffMin >= 117 && diffMin <= 123) return 60
  return null
}

export function isTargetLesson(summary) {
  return Boolean(summary) && summary.includes(REQUIRED_LESSON_PHRASE)
}

export function isCancelledLesson(summary, keywords = DEFAULT_CANCELLED_KEYWORDS) {
  if (!summary) return false
  const lower = summary.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

export function isPaidCancellation(summary, phrases = DEFAULT_PAID_CANCELLATION_PHRASES) {
  return Boolean(summary) && phrases.some(phrase => summary.includes(phrase))
}

export function normalizeStudentName(name) {
  const words = name.split(' ').filter(w => !w.startsWith('('))
  return words.slice(0, 2).join(' ') || name
}

export function inferStudentName(summary, regex = null) {
  if (!summary) return null

  if (regex) {
    const match = summary.match(new RegExp(regex))
    if (match) {
      const name = match[1].trim()
      if (name.includes(REQUIRED_LESSON_PHRASE)) {
        const prefix = name.split(REQUIRED_LESSON_PHRASE)[0].trim()
        return prefix ? normalizeStudentName(prefix) : null
      }
      return name
    }
  }

  for (const sep of [' - ', ' | ', ': ']) {
    if (summary.includes(sep)) return summary.split(sep)[0].trim()
  }

  if (summary.includes(REQUIRED_LESSON_PHRASE)) {
    const prefix = summary.split(REQUIRED_LESSON_PHRASE)[0].trim()
    if (prefix) return normalizeStudentName(prefix)
  }

  return normalizeStudentName(summary.trim())
}

export function isRegular(lessons, invoiceStart, invoiceEnd) {
  const inWindow = lessons.filter(dt => dt >= invoiceStart && dt < invoiceEnd)
  if (inWindow.length >= 4) return true

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
  let cursor = new Date(invoiceStart)
  while (cursor < invoiceEnd) {
    const intervalEnd = new Date(Math.min(cursor.getTime() + SEVEN_DAYS_MS, invoiceEnd.getTime()))
    if (!inWindow.some(dt => dt >= cursor && dt < intervalEnd)) return false
    cursor = intervalEnd
  }
  return true
}

export function resolvePriceTable(student, regular, regularPrices, nonRegularPrices, customPrices) {
  const defaults = regular ? regularPrices : nonRegularPrices
  if (customPrices && student in customPrices) {
    const entry = customPrices[student]
    if (entry && typeof entry === 'object') {
      if ('regular' in entry || 'non_regular' in entry) {
        const tierKey = regular ? 'regular' : 'non_regular'
        const tierPrices = entry[tierKey]
        if (tierPrices && typeof tierPrices === 'object') return fillDurations(tierPrices, defaults)
        const fallbackKey = regular ? 'non_regular' : 'regular'
        const fallback = entry[fallbackKey]
        if (fallback && typeof fallback === 'object') return fillDurations(fallback, defaults)
      }
      if ('60' in entry && '45' in entry && '30' in entry) return entry
    }
  }
  return defaults
}

function fillDurations(prices, defaults) {
  return {
    '60': prices['60'] ?? defaults['60'],
    '45': prices['45'] ?? defaults['45'],
    '30': prices['30'] ?? defaults['30'],
  }
}

export function calculatePayments(events, config, monthStr) {
  const { start: monthStart, end: monthEnd } = monthWindow(monthStr)
  const cancelledKeywords = config.cancelled_keywords ?? DEFAULT_CANCELLED_KEYWORDS
  const paidCancellationPhrases = config.paid_cancellation_phrases ?? DEFAULT_PAID_CANCELLATION_PHRASES
  const nameRegex = config.student_name_regex ?? null
  const regularPrices = config.prices.regular
  const nonRegularPrices = config.prices.non_regular
  const customPrices = config.custom_prices ?? {}

  const lessonDatetimes = {}
  const stats = {}
  const forceRegular = new Set()

  for (const event of events) {
    const summary = event.summary ?? ''
    if (!isTargetLesson(summary)) continue

    const paidCancel = isPaidCancellation(summary, paidCancellationPhrases)
    if (!paidCancel && isCancelledLesson(summary, cancelledKeywords)) continue

    const student = inferStudentName(summary, nameRegex)
    const duration = lessonDurationMinutes(event)
    const doubleDuration = duration ? null : doubleLessonDurationMinutes(event)
    const startRaw = event?.start?.dateTime
    if (!student || (!duration && !doubleDuration) || !startRaw) continue

    if (paidCancel) forceRegular.add(student)

    const startDt = new Date(startRaw)
    if (!lessonDatetimes[student]) lessonDatetimes[student] = []
    lessonDatetimes[student].push(startDt)

    if (startDt < monthStart || startDt >= monthEnd) continue

    if (!stats[student]) stats[student] = { count_60: 0, count_45: 0, count_30: 0 }
    if (duration === 60) stats[student].count_60++
    else if (duration === 45) stats[student].count_45++
    else if (duration === 30) stats[student].count_30++
    else if (doubleDuration === 60) stats[student].count_60 += 2
    else if (doubleDuration === 45) stats[student].count_45 += 2
  }

  const rows = []
  let totalAmount = 0

  for (const student of Object.keys(stats).sort()) {
    const s = stats[student]
    const regular = isRegular(lessonDatetimes[student] ?? [], monthStart, monthEnd)
    const priceTable = resolvePriceTable(
      student,
      regular || forceRegular.has(student),
      regularPrices,
      nonRegularPrices,
      customPrices,
    )

    const amount = s.count_60 * Number(priceTable['60'])
      + s.count_45 * Number(priceTable['45'])
      + s.count_30 * Number(priceTable['30'])
    totalAmount += amount

    rows.push({
      student,
      student_type: regular ? 'regular' : 'non_regular',
      lessons_60: s.count_60,
      lessons_45: s.count_45,
      lessons_30: s.count_30,
      amount_due: Math.round(amount * 100) / 100,
    })
  }

  return {
    rows,
    summary: {
      month: monthStr,
      students: rows.length,
      total_amount_due: Math.round(totalAmount * 100) / 100,
    },
  }
}
