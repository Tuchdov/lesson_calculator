export const DEFAULT_LESSON_KEYWORDS = ['פיתוח קול']
export const DEFAULT_PAID_CANCELLATION_PHRASES = ['ביטול בתשלום']
export const DEFAULT_CANCELLED_KEYWORDS = ['בוטל', 'מבוטל']
// Titles containing one of these mark a make-up add-on: a non-standard
// duration is charged as the standard lesson inside it, extra minutes free.
export const DEFAULT_MAKEUP_PHRASES = []
// Make-up phrases auto-price events of MAKEUP_AUTO_MIN to MAKEUP_AUTO_MAX - 1 minutes.
export const MAKEUP_AUTO_MIN = 30
export const MAKEUP_AUTO_MAX = 90
// A parent's name trails the student's in titles and saved keys
// ("ענבר אמא עינת", "אלה עוז ✨ אמא נועה") — everything from the marker on is
// dropped. A marker in first position is kept so the name is never emptied.
const PARENT_MARKERS = ['אמא', 'אבא']

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

// Raw minutes of a timed event, or null for all-day / malformed events.
export function eventMinutes(event) {
  const startRaw = event?.start?.dateTime
  const endRaw = event?.end?.dateTime
  if (!startRaw || !endRaw) return null
  return Math.round((new Date(endRaw) - new Date(startRaw)) / 60000)
}

// Longest keyword first, so "פיתוח קול מתקדם" wins over "פיתוח קול" when
// both are configured and the name is cut around the right one.
function matchedLessonKeyword(summary, keywords) {
  if (!summary) return null
  const sorted = keywords.filter(k => typeof k === 'string' && k).sort((a, b) => b.length - a.length)
  return sorted.find(k => summary.includes(k)) ?? null
}

export function isTargetLesson(summary, keywords = DEFAULT_LESSON_KEYWORDS) {
  return matchedLessonKeyword(summary, keywords) !== null
}

export function isCancelledLesson(summary, keywords = DEFAULT_CANCELLED_KEYWORDS) {
  if (!summary) return false
  const lower = summary.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

export function isPaidCancellation(summary, phrases = DEFAULT_PAID_CANCELLATION_PHRASES) {
  return Boolean(summary) && phrases.some(phrase => summary.includes(phrase))
}

// Keeps the first two words of the student's own name. Whole "(...)" groups
// are notes ("(9.5)", "(אמא עינת)"), words with digits are dates, words with
// no letters are decoration (✨), and a parent marker ends the name. A plain
// 1-2 digit number after the first word ("דנה 1") tells two students with the
// same first name apart, so it stays part of the name.
export function normalizeStudentName(name) {
  const words = []
  for (const w of name.replace(/\([^)]*\)?/g, ' ').replace(/\)/g, ' ').split(/\s+/)) {
    if (!w) continue
    const isNumberTag = /^\d{1,2}$/.test(w) && words.length > 0
    if (isNumberTag || (/\p{L}/u.test(w) && !/\d/.test(w))) words.push(w)
  }
  const parentAt = words.findIndex((w, i) => i > 0 && PARENT_MARKERS.includes(w))
  const own = parentAt === -1 ? words : words.slice(0, parentAt)
  return own.slice(0, 2).join(' ') || name
}

// Saved data can be keyed by a fuller spelling than the calendar yields, e.g.
// a CSV import stored "ענבר 11.5 (אמא עינת)" while titles give "ענבר". A saved
// key matches when it normalizes to the parsed name (exact, not fuzzy). The
// canonical key prefers one with a custom price, so pricing never misses;
// `aliases` lists every matching key so details split across spellings
// (phone under one, price under another) can still be merged.
export function resolveSavedStudent(student, customPrices = {}, customerDetails = {}) {
  const matches = (record) => Object.keys(record ?? {})
    .filter(k => k === student || normalizeStudentName(k) === student)
    .sort((a, b) => (b === student) - (a === student) || a.localeCompare(b, 'he'))
  const priced = matches(customPrices)
  const detailed = matches(customerDetails)
  const key = priced[0] ?? detailed[0] ?? student
  const aliases = [...new Set([student, ...priced, ...detailed])].filter(a => a !== key)
  return { key, aliases }
}

// Spellings merged into one row are only safe when they don't contradict each
// other: price under one key and phone under another is one student, two
// different phones (or names, or prices) is probably two students who share a
// first name. Returns the conflicting fields; a non-empty result blocks sending.
// Values are compared in a normalized form, so "050-1234567" vs "0501234567",
// extra spaces in a name, or a flat price vs the same tiered price are not
// mistaken for two students.
const CONFLICT_FIELDS = {
  phone: v => String(v).replace(/\D/g, ''),
  full_name: v => String(v).trim().replace(/\s+/g, ' '),
}
export function savedNameConflicts(keys, customPrices = {}, customerDetails = {}, defaults = {}) {
  const conflicts = []
  for (const [field, normalize] of Object.entries(CONFLICT_FIELDS)) {
    const values = new Set(keys.map(k => customerDetails?.[k]?.[field]).filter(v => v !== '' && v != null).map(normalize).filter(Boolean))
    if (values.size > 1) conflicts.push(field)
  }
  const prices = new Set(keys.map(k => billedPriceKey(k, customPrices, defaults)).filter(Boolean))
  if (prices.size > 1) conflicts.push('price')
  return conflicts
}

// What a saved key's custom price actually bills, per tier, via the same
// resolvePriceTable the calculation uses (so a partial flat price that falls
// back to the defaults compares as the defaults). Null when the key has no
// price filled in.
function billedPriceKey(key, customPrices, defaults) {
  const entry = customPrices?.[key]
  const filled = v => Number.isFinite(Number(v)) && v !== '' && v != null
  const hasPrice = entry && typeof entry === 'object' && Object.values(entry).some(v => (v && typeof v === 'object') ? Object.values(v).some(filled) : filled(v))
  if (!hasPrice) return null
  const tier = regular => {
    const t = resolvePriceTable(key, regular, defaults?.regular ?? {}, defaults?.non_regular ?? {}, customPrices)
    return ['60', '45', '30'].map(d => Number(t?.[d]))
  }
  return JSON.stringify([tier(true), tier(false)])
}

// A calculated row was matched to saved students at Calculate time. It needs
// recalculating (and sending waits) when, with the saved students as they are
// now, its key, its other spellings or its conflicts would come out different,
// e.g. a conflicting spelling added on Custom Prices since then.
export function rowNeedsRecalc(row, customPrices = {}, customerDetails = {}, defaults = {}) {
  const now = resolveSavedStudent(normalizeStudentName(row.student), customPrices, customerDetails)
  if (now.key !== row.student) return true
  const same = (a, b) => [...a].sort().join('\u0000') === [...b].sort().join('\u0000')
  if (!same(now.aliases, row.aliases ?? [])) return true
  return !same(savedNameConflicts([now.key, ...now.aliases], customPrices, customerDetails, defaults), row.name_conflicts ?? [])
}

function cleanNameCandidate(name) {
  return name
    .replace(/^(?:\s*[-|:]\s*)+/, '')
    .replace(/(?:\s*[-|:]\s*)+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameAroundLessonPhrase(text, lessonKeywords) {
  const keyword = matchedLessonKeyword(text, lessonKeywords)
  if (!keyword) return normalizeStudentName(text)

  const phraseIndex = text.indexOf(keyword)
  const prefix = cleanNameCandidate(text.slice(0, phraseIndex))
  if (prefix) return normalizeStudentName(prefix)

  const suffix = cleanNameCandidate(text.slice(phraseIndex + keyword.length))
  return suffix ? normalizeStudentName(suffix) : null
}

function withoutIgnoredPhrases(summary, ignoredPhrases) {
  let cleaned = summary
  // Prefer the most specific label when configured phrases overlap.
  const phrases = [...ignoredPhrases].sort((a, b) => String(b).length - String(a).length)
  for (const phrase of phrases) {
    if (typeof phrase === 'string' && phrase) cleaned = cleaned.replaceAll(phrase, ' ')
  }
  return cleanNameCandidate(cleaned)
}

export function inferStudentName(summary, regex = null, ignoredPhrases = [], lessonKeywords = DEFAULT_LESSON_KEYWORDS) {
  if (!summary) return null
  const cleanedSummary = withoutIgnoredPhrases(summary, ignoredPhrases)
  if (!cleanedSummary) return null

  if (regex) {
    const match = cleanedSummary.match(new RegExp(regex))
    if (match) {
      const name = cleanNameCandidate(match[1] ?? '')
      const candidate = name && nameAroundLessonPhrase(name, lessonKeywords)
      if (candidate) return candidate
    }
  }

  for (const sep of [' - ', ' | ', ': ']) {
    if (!cleanedSummary.includes(sep)) continue
    for (const part of cleanedSummary.split(sep)) {
      const cleanedPart = cleanNameCandidate(part)
      const candidate = cleanedPart && nameAroundLessonPhrase(cleanedPart, lessonKeywords)
      if (candidate) return candidate
    }
  }

  const candidate = nameAroundLessonPhrase(cleanedSummary, lessonKeywords)
  if (candidate) return candidate

  return normalizeStudentName(cleanedSummary)
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
  const lessonKeywords = config.lesson_keywords ?? DEFAULT_LESSON_KEYWORDS
  const cancelledKeywords = config.cancelled_keywords ?? DEFAULT_CANCELLED_KEYWORDS
  const paidCancellationPhrases = config.paid_cancellation_phrases ?? DEFAULT_PAID_CANCELLATION_PHRASES
  const makeupPhrases = config.makeup_phrases ?? DEFAULT_MAKEUP_PHRASES
  const nameRegex = config.student_name_regex ?? null
  const regularPrices = config.prices.regular
  const nonRegularPrices = config.prices.non_regular
  const customPrices = config.custom_prices ?? {}
  const customerDetails = config.customer_details ?? {}

  const lessonDatetimes = {}
  const stats = {}
  const reviewItems = {}
  const aliases = {}
  const forceRegular = new Set()
  const savedKeyCache = new Map()

  const canonicalStudent = (parsed) => {
    if (!savedKeyCache.has(parsed)) {
      const resolved = resolveSavedStudent(parsed, customPrices, customerDetails)
      savedKeyCache.set(parsed, resolved)
      aliases[resolved.key] = [...new Set([...(aliases[resolved.key] ?? []), ...resolved.aliases])]
    }
    return savedKeyCache.get(parsed).key
  }
  const ensureStats = (student) => {
    if (!stats[student]) stats[student] = { count_60: 0, count_45: 0, count_30: 0 }
  }

  for (const event of events) {
    const summary = event.summary ?? ''
    if (!isTargetLesson(summary, lessonKeywords)) continue

    const paidCancel = isPaidCancellation(summary, paidCancellationPhrases)
    if (!paidCancel && isCancelledLesson(summary, cancelledKeywords)) continue

    // Paid-cancellation labels describe the event; they are not student names.
    // Remove them before applying the configured name parser so titles may put
    // the label either before or after the actual student name.
    const parsed = inferStudentName(summary, nameRegex, paidCancellationPhrases, lessonKeywords)
    const startRaw = event?.start?.dateTime
    if (!parsed || !startRaw) continue
    const student = canonicalStudent(parsed)
    const duration = lessonDurationMinutes(event)
    const doubleDuration = duration ? null : doubleLessonDurationMinutes(event)
    const startDt = new Date(startRaw)
    const inMonth = startDt >= monthStart && startDt < monthEnd

    // Every lesson that happened counts as attendance for the regular tier,
    // including ones whose length needs review below.
    if (paidCancel) forceRegular.add(student)
    if (!lessonDatetimes[student]) lessonDatetimes[student] = []
    lessonDatetimes[student].push(startDt)

    // A duration outside the 30/45/60 tiers (e.g. "+15 min make-up") used to
    // be dropped silently, leaving a total that looked right but was too low.
    // It is surfaced for the teacher to price instead.
    if (!duration && !doubleDuration) {
      if (!inMonth) continue
      ensureStats(student)
      if (!reviewItems[student]) reviewItems[student] = []
      const minutes = eventMinutes(event)
      const makeup = makeupPhrases.some(p => p && summary.includes(p))
      reviewItems[student].push({
        id: event.id ?? startRaw,
        summary,
        start: startRaw,
        minutes,
        makeup,
        // "One standard lesson, extra free" only fits one lesson plus a short
        // add-on; a longer block or a sub-30-minute event still asks.
        auto: makeup && minutes >= MAKEUP_AUTO_MIN && minutes < MAKEUP_AUTO_MAX ? 'base' : null,
      })
      continue
    }

    if (!inMonth) continue

    ensureStats(student)
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

    // Excludes review items: their price depends on the teacher's answer,
    // which rowPricing.js applies on top of this.
    const amount = s.count_60 * Number(priceTable['60'])
      + s.count_45 * Number(priceTable['45'])
      + s.count_30 * Number(priceTable['30'])
    totalAmount += amount

    rows.push({
      student,
      aliases: aliases[student] ?? [],
      name_conflicts: savedNameConflicts([student, ...(aliases[student] ?? [])], customPrices, customerDetails, config.prices),
      student_type: (regular || forceRegular.has(student)) ? 'regular' : 'non_regular',
      lessons_60: s.count_60,
      lessons_45: s.count_45,
      lessons_30: s.count_30,
      amount_due: Math.round(amount * 100) / 100,
      review_items: reviewItems[student] ?? [],
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
