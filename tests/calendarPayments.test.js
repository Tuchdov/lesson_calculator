import { assertEquals, assertFalse } from '@std/assert'
import {
  calculatePayments,
  DEFAULT_CANCELLED_KEYWORDS,
  doubleLessonDurationMinutes,
  inferStudentName,
  isCancelledLesson,
  isPaidCancellation,
  isRegular,
  isTargetLesson,
  lessonDurationMinutes,
  normalizeStudentName,
  resolvePriceTable,
  resolveSavedStudent,
  savedNameConflicts,
  rowNeedsRecalc,
} from '../src/lib/calendarPayments.js'
import { computeRowAmount } from '../src/lib/rowPricing.js'

function makeEvent(startIso, endIso) {
  return { start: { dateTime: startIso }, end: { dateTime: endIso } }
}

function makeLessonEvent(summary, startIso, endIso) {
  return { summary, start: { dateTime: startIso }, end: { dateTime: endIso } }
}

function utc(year, month, day, hour = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour))
}

const BASE_CONFIG = {
  cancelled_keywords: ['cancelled', 'canceled', 'cancel', 'בוטל', 'מבוטל'],
  student_name_regex: null,
  prices: {
    regular: { '60': 250, '45': 200, '30': 180 },
    non_regular: { '60': 270, '45': 220, '30': 200 },
  },
  custom_prices: {},
}

// 1
Deno.test('isTargetLesson: true when Hebrew phrase present', () => {
  assertEquals(isTargetLesson('נועה - פיתוח קול'), true)
  assertEquals(isTargetLesson('דנה: שיעור פיתוח קול מתקדם'), true)
  assertEquals(isTargetLesson('דנה - שיעור פסנתר'), false)
  assertEquals(isTargetLesson('Alice - voice lesson'), false)
})

// 2
Deno.test('isTargetLesson: false for empty or missing summary', () => {
  assertEquals(isTargetLesson(''), false)
  assertEquals(isTargetLesson(null), false)
})

// 3
Deno.test('isCancelledLesson: English keywords', () => {
  const kw = ['cancelled', 'canceled', 'cancel', 'בוטל', 'מבוטל']
  assertEquals(isCancelledLesson('Alice - lesson cancelled', kw), true)
  assertEquals(isCancelledLesson('Alice - lesson canceled', kw), true)
  assertEquals(isCancelledLesson('Alice - lesson', kw), false)
})

// 4
Deno.test('isCancelledLesson: Hebrew keywords', () => {
  const kw = ['cancelled', 'canceled', 'cancel', 'בוטל', 'מבוטל']
  assertEquals(isCancelledLesson('דנה - שיעור בוטל', kw), true)
  assertEquals(isCancelledLesson('יואב - שיעור מבוטל', kw), true)
  assertEquals(isCancelledLesson('דנה - שיעור', kw), false)
})

// 5
Deno.test('lessonDurationMinutes: exact 60/45/30', () => {
  const base = utc(2026, 2, 1, 10)
  const add = (min) => new Date(base.getTime() + min * 60000).toISOString()
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(60))), 60)
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(45))), 45)
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(30))), 30)
})

// 6
Deno.test('lessonDurationMinutes: fuzzy rounding', () => {
  const base = utc(2026, 2, 1, 10)
  const add = (min) => new Date(base.getTime() + min * 60000).toISOString()
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(59))), 60)
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(44))), 45)
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(31))), 30)
})

// 7
Deno.test('inferStudentName: separator patterns (-, |, :)', () => {
  assertEquals(inferStudentName('Alice - Voice Lesson'), 'Alice')
  assertEquals(inferStudentName('Bob | 45 min'), 'Bob')
  assertEquals(inferStudentName('Carol: training'), 'Carol')
})

// 8
Deno.test('inferStudentName: Hebrew separator patterns', () => {
  assertEquals(inferStudentName('נועה - שיעור פיתוח קול'), 'נועה')
  assertEquals(inferStudentName('יואב | 45 דקות'), 'יואב')
  assertEquals(inferStudentName('דנה: שיעור'), 'דנה')
})

// 9
Deno.test('isRegular: weekly lessons = regular', () => {
  const start = utc(2026, 2, 1)
  const end = utc(2026, 3, 1)
  const lessons = [utc(2026, 2, 2, 10), utc(2026, 2, 9, 10), utc(2026, 2, 16, 10), utc(2026, 2, 24, 10)]
  assertEquals(isRegular(lessons, start, end), true)
})

// 10
Deno.test('isRegular: missing a week = non-regular', () => {
  const start = utc(2026, 2, 1)
  const end = utc(2026, 3, 1)
  const lessons = [utc(2026, 2, 2, 10), utc(2026, 2, 9, 10), utc(2026, 2, 16, 10)]
  assertEquals(isRegular(lessons, start, end), false)
})

// 11
Deno.test('isRegular: 4 lessons in same week = regular (4+ threshold)', () => {
  const start = utc(2026, 2, 1)
  const end = utc(2026, 3, 1)
  const lessons = [utc(2026, 2, 2, 10), utc(2026, 2, 3, 10), utc(2026, 2, 4, 10), utc(2026, 2, 5, 10)]
  assertEquals(isRegular(lessons, start, end), true)
})

// 12
Deno.test('isRegular: shifted weekday across weeks = still regular', () => {
  const start = utc(2026, 5, 1)
  const end = utc(2026, 6, 1)
  const lessons = [
    utc(2026, 5, 1, 10),
    utc(2026, 5, 9, 10),
    utc(2026, 5, 18, 10),
    utc(2026, 5, 25, 10),
    utc(2026, 5, 30, 10),
  ]
  assertEquals(isRegular(lessons, start, end), true)
})

// 13
Deno.test('isPaidCancellation: Hebrew phrase detected / not detected (default phrase list)', () => {
  assertEquals(isPaidCancellation('ליאור פיתוח קול ביטול בתשלום'), true)
  assertEquals(isPaidCancellation('ביטול בתשלום פיתוח קול'), true)
  assertFalse(isPaidCancellation('ליאור פיתוח קול'))
  assertFalse(isPaidCancellation('Alice - lesson cancelled'))
})

Deno.test('isPaidCancellation: accepts a custom phrase list, matching any entry', () => {
  const phrases = ['ביטול בתשלום', 'cancelled - billed', 'paid cancellation']
  assertEquals(isPaidCancellation('דנה - cancelled - billed', phrases), true)
  assertEquals(isPaidCancellation('דנה - paid cancellation', phrases), true)
  assertEquals(isPaidCancellation('דנה - ביטול בתשלום', phrases), true)
  assertFalse(isPaidCancellation('דנה - lesson', phrases))
})

Deno.test('isPaidCancellation: empty phrase list never matches', () => {
  assertFalse(isPaidCancellation('דנה - ביטול בתשלום', []))
})

Deno.test('calculatePayments: honors config.paid_cancellation_phrases for a custom phrase', () => {
  const events = [
    makeLessonEvent(
      'דנה - פיתוח קול - cancel - school holiday paid',
      '2026-02-02T10:00:00.000Z',
      '2026-02-02T11:00:00.000Z',
    ),
  ]

  // Without the custom phrase configured, "cancel" matches a generic cancelled
  // keyword and the lesson is dropped entirely (not billed).
  const withoutPhrase = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(withoutPhrase.rows.length, 0)

  // With the custom phrase configured, it's recognized as a paid cancellation
  // and billed at the regular rate despite being a single, non-regular lesson.
  const configWithPhrase = { ...BASE_CONFIG, paid_cancellation_phrases: ['school holiday paid'] }
  const { rows } = calculatePayments(events, configWithPhrase, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_60, 1)
  assertEquals(rows[0].amount_due, BASE_CONFIG.prices.regular['60'])
  // student_type must agree with the rate actually billed — otherwise any UI
  // that re-derives the amount from student_type (as EditableTable/
  // CalculatorPage do for display and payment links) computes a different
  // number than amount_due above.
  assertEquals(rows[0].student_type, 'regular')
})

Deno.test('isCancelledLesson: DEFAULT_CANCELLED_KEYWORDS is exported and usable as a default', () => {
  assertEquals(isCancelledLesson('דנה - שיעור בוטל', DEFAULT_CANCELLED_KEYWORDS), true)
  assertEquals(isCancelledLesson('דנה - שיעור מבוטל', DEFAULT_CANCELLED_KEYWORDS), true)
  assertFalse(isCancelledLesson('דנה - שיעור', DEFAULT_CANCELLED_KEYWORDS))
})

Deno.test('calculatePayments: honors config.cancelled_keywords for a custom keyword', () => {
  const events = [
    makeLessonEvent('דנה - פיתוח קול - postponed', '2026-02-02T10:00:00.000Z', '2026-02-02T11:00:00.000Z'),
  ]

  // "postponed" isn't a keyword in BASE_CONFIG, so this lesson is billed normally.
  const withoutKeyword = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(withoutKeyword.rows.length, 1)
  assertEquals(withoutKeyword.rows[0].lessons_60, 1)

  // With "postponed" configured as a cancelled keyword, the lesson is dropped.
  const configWithKeyword = { ...BASE_CONFIG, cancelled_keywords: ['postponed'] }
  const { rows } = calculatePayments(events, configWithKeyword, '2026-02')
  assertEquals(rows.length, 0)
})

// 14
Deno.test('inferStudentName: strips lesson phrase + parenthetical tokens', () => {
  assertEquals(inferStudentName('רותם עצמון (14) פיתוח קול שיעור ראשון ✨ אמא אנדראה'), 'רותם עצמון')
  assertEquals(inferStudentName('רותם עצמון (14) פיתוח קול ✨ אמא אנדראה'), 'רותם עצמון')
  assertEquals(inferStudentName('ליאור פיתוח קול ביטול בתשלום'), 'ליאור')
})

Deno.test('inferStudentName: ignores a paid-cancellation phrase before the student name', () => {
  const phrases = ['ביטול ברגע האחרון']
  const regex = '^([^-|:]+)'

  assertEquals(
    inferStudentName('ביטול ברגע האחרון - אשלי - פיתוח קול', regex, phrases),
    'אשלי',
  )
  assertEquals(
    inferStudentName('ביטול ברגע האחרון - פיתוח קול - אשלי', regex, phrases),
    'אשלי',
  )
  assertEquals(
    inferStudentName('ביטול ברגע האחרון אשלי פיתוח קול', regex, phrases),
    'אשלי',
  )
    assertEquals(
    inferStudentName('אשלי פיתוח קול - ביטול ברגע האחרון שיעור כפול', regex, phrases),
    'אשלי',
  )
})

Deno.test('calculatePayments: paid-cancellation phrase is not used as the student name', () => {
  const events = [
    makeLessonEvent(
      'אשלי - פיתוח קול',
      '2026-02-01T10:00:00.000Z',
      '2026-02-01T11:00:00.000Z',
    ),
    makeLessonEvent(
      'ביטול ברגע האחרון - אשלי - פיתוח קול',
      '2026-02-02T10:00:00.000Z',
      '2026-02-02T11:00:00.000Z',
    ),
  ]
  const config = {
    ...BASE_CONFIG,
    student_name_regex: '^([^-|:]+)',
    paid_cancellation_phrases: ['ביטול ברגע האחרון'],
  }

  const { rows } = calculatePayments(events, config, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].student, 'אשלי')
  assertEquals(rows[0].lessons_60, 2)
  assertEquals(rows[0].amount_due, 2 * BASE_CONFIG.prices.regular['60'])
})

// 15
Deno.test('resolvePriceTable: legacy flat format overrides both types', () => {
  const regular = { '60': 250, '45': 200, '30': 180 }
  const nonRegular = { '60': 270, '45': 220, '30': 200 }
  const custom = { Alice: { '60': 300, '45': 250, '30': 220 } }

  assertEquals(resolvePriceTable('Alice', true, regular, nonRegular, custom), custom.Alice)
  assertEquals(resolvePriceTable('Alice', false, regular, nonRegular, custom), custom.Alice)
  assertEquals(resolvePriceTable('Bob', true, regular, nonRegular, custom), regular)
  assertEquals(resolvePriceTable('Bob', false, regular, nonRegular, custom), nonRegular)
  assertEquals(resolvePriceTable('Alice', true, regular, nonRegular, null), regular)
})

// 16
Deno.test('resolvePriceTable: tiered format selects by regularity + normalizeStudentName', () => {
  const regular = { '60': 250, '45': 200, '30': 180 }
  const nonRegular = { '60': 270, '45': 220, '30': 200 }
  const custom = {
    Alice: {
      regular: { '60': 200, '45': 150, '30': 120 },
      non_regular: { '60': 250, '45': 150, '30': 150 },
    },
  }

  assertEquals(resolvePriceTable('Alice', true, regular, nonRegular, custom), custom.Alice.regular)
  assertEquals(resolvePriceTable('Alice', false, regular, nonRegular, custom), custom.Alice.non_regular)
  assertEquals(resolvePriceTable('Bob', true, regular, nonRegular, custom), regular)
  assertEquals(resolvePriceTable('Bob', false, regular, nonRegular, custom), nonRegular)
})

Deno.test('normalizeStudentName: strips parenthetical tokens', () => {
  assertEquals(normalizeStudentName('רותם עצמון (14)'), 'רותם עצמון')
  assertEquals(normalizeStudentName('עומר (8)'), 'עומר')
  assertEquals(normalizeStudentName('אהרון פיטוסי'), 'אהרון פיטוסי')
  assertEquals(normalizeStudentName('אחינועם'), 'אחינועם')
})

// ── back-to-back double lessons ───────────────────────────────────────────────

// 17
Deno.test('calculatePayments: two back-to-back 60-min events count as two separate lessons', () => {
  const events = [
    makeLessonEvent('דנה - פיתוח קול', '2026-02-02T10:00:00.000Z', '2026-02-02T11:00:00.000Z'),
    makeLessonEvent('דנה - פיתוח קול', '2026-02-02T11:00:00.000Z', '2026-02-02T12:00:00.000Z'),
  ]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_60, 2)
  assertEquals(rows[0].amount_due, 2 * BASE_CONFIG.prices.non_regular['60'])
})

// 18
Deno.test('calculatePayments: two back-to-back 45-min events count as two separate lessons', () => {
  const events = [
    makeLessonEvent('דנה - פיתוח קול', '2026-02-02T10:00:00.000Z', '2026-02-02T10:45:00.000Z'),
    makeLessonEvent('דנה - פיתוח קול', '2026-02-02T10:45:00.000Z', '2026-02-02T11:30:00.000Z'),
  ]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_45, 2)
  assertEquals(rows[0].amount_due, 2 * BASE_CONFIG.prices.non_regular['45'])
})

// 19
Deno.test('lessonDurationMinutes: a single 120-min block is not one of the standard single-lesson durations', () => {
  const base = utc(2026, 2, 1, 10)
  const add = (min) => new Date(base.getTime() + min * 60000).toISOString()
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(120))), null)
})

// 20
Deno.test('lessonDurationMinutes: a single 90-min block is not one of the standard single-lesson durations', () => {
  const base = utc(2026, 2, 1, 10)
  const add = (min) => new Date(base.getTime() + min * 60000).toISOString()
  assertEquals(lessonDurationMinutes(makeEvent(base.toISOString(), add(90))), null)
})

// 21
Deno.test('doubleLessonDurationMinutes: 120-min block detected as a double 60-min lesson', () => {
  const base = utc(2026, 2, 1, 10)
  const add = (min) => new Date(base.getTime() + min * 60000).toISOString()
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(120))), 60)
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(117))), 60)
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(123))), 60)
})

// 22
Deno.test('doubleLessonDurationMinutes: 90-min block detected as a double 45-min lesson', () => {
  const base = utc(2026, 2, 1, 10)
  const add = (min) => new Date(base.getTime() + min * 60000).toISOString()
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(90))), 45)
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(87))), 45)
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(93))), 45)
})

// 23
Deno.test('doubleLessonDurationMinutes: single-length durations (30/45/60) are not double blocks', () => {
  const base = utc(2026, 2, 1, 10)
  const add = (min) => new Date(base.getTime() + min * 60000).toISOString()
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(30))), null)
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(45))), null)
  assertEquals(doubleLessonDurationMinutes(makeEvent(base.toISOString(), add(60))), null)
})

// 24
Deno.test('calculatePayments: a single 120-min event is counted as two 60-min lessons', () => {
  const events = [
    makeLessonEvent('דנה - פיתוח קול', '2026-02-02T10:00:00.000Z', '2026-02-02T12:00:00.000Z'),
  ]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_60, 2)
  assertEquals(rows[0].amount_due, 2 * BASE_CONFIG.prices.non_regular['60'])
})

// 25
Deno.test('calculatePayments: a single 90-min event is counted as two 45-min lessons', () => {
  const events = [
    makeLessonEvent('דנה - פיתוח קול', '2026-02-02T10:00:00.000Z', '2026-02-02T11:30:00.000Z'),
  ]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_45, 2)
  assertEquals(rows[0].amount_due, 2 * BASE_CONFIG.prices.non_regular['45'])
})

// ── high lesson volume per month ───────────────────────────────────────────────

// 26
Deno.test('calculatePayments: 8 lessons in a month are all counted (no artificial 4-5 lesson cap)', () => {
  const days = [2, 6, 9, 13, 16, 20, 23, 27]
  const events = days.map(day =>
    makeLessonEvent(
      'יואב - פיתוח קול',
      `2026-02-${String(day).padStart(2, '0')}T10:00:00.000Z`,
      `2026-02-${String(day).padStart(2, '0')}T11:00:00.000Z`,
    )
  )
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_60, 8)
  assertEquals(rows[0].student_type, 'regular')
  assertEquals(rows[0].amount_due, 8 * BASE_CONFIG.prices.regular['60'])
})

// 27
Deno.test('calculatePayments: 25 lessons in a month (near-daily) are all counted', () => {
  const events = []
  for (let day = 1; day <= 25; day++) {
    events.push(makeLessonEvent(
      'מאיה - פיתוח קול',
      `2026-02-${String(day).padStart(2, '0')}T09:00:00.000Z`,
      `2026-02-${String(day).padStart(2, '0')}T10:00:00.000Z`,
    ))
  }
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_60, 25)
  assertEquals(rows[0].student_type, 'regular')
  assertEquals(rows[0].amount_due, 25 * BASE_CONFIG.prices.regular['60'])
})

// ── saved-key matching (real student spellings) ───────────────────────────────

Deno.test('normalizeStudentName: drops whole (...) notes, date-like numbers, decoration and parent notes', () => {
  assertEquals(normalizeStudentName('ענבר 11.5 (אמא עינת)'), 'ענבר')
  assertEquals(normalizeStudentName('ענבר (11.5) אמא עינת'), 'ענבר')
  assertEquals(normalizeStudentName('אלה עוז (אמה נועה)'), 'אלה עוז')
  assertEquals(normalizeStudentName('אלה עוז (9.5)'), 'אלה עוז')
  assertEquals(normalizeStudentName('אלה עוז(9.5)'), 'אלה עוז')
  assertEquals(normalizeStudentName('אלה עוז ✨ אמא נועה'), 'אלה עוז')
  // Value: protects=an unclosed "(" note is dropped and a name with no usable words stays non-empty; fails_when=the "\)?" in the note regex becomes "\)" (keeps "(אמא") or the "|| name" fallback is removed (empty name => event silently skipped); why_new=existing cases all close their parentheses and keep at least one word; seam=none
  assertEquals(normalizeStudentName('ענבר (אמא עינת'), 'ענבר')
  assertEquals(normalizeStudentName('✨ 12'), '✨ 12')
})

Deno.test('inferStudentName: real title with a trailing parent note keeps only the student', () => {
  assertEquals(inferStudentName('אלה עוז (9.5) - פיתוח קול ✨ אמא נועה', '^([^-|:]+)'), 'אלה עוז')
  assertEquals(inferStudentName('ענבר (11.5) אמא עינת - פיתוח קול', '^([^-|:]+)'), 'ענבר')
})

Deno.test('resolveSavedStudent: maps the parsed name onto the fuller saved key', () => {
  const custom = { 'ענבר 11.5 (אמא עינת)': { '60': 230, '45': 200, '30': 180 } }
  assertEquals(resolveSavedStudent('ענבר', custom, {}).key, 'ענבר 11.5 (אמא עינת)')
})

Deno.test('resolveSavedStudent: prefers a priced key and lists other spellings as aliases', () => {
  const custom = { 'אלה עוז (9.5)': { '60': 240, '45': 200, '30': 180 } }
  const details = { 'אלה עוז (אמה נועה)': { phone: '050-1234567' }, 'אלה עוז': { full_name: 'אלה עוז' } }
  const { key, aliases } = resolveSavedStudent('אלה עוז', custom, details)
  assertEquals(key, 'אלה עוז (9.5)')
  assertEquals(aliases.sort(), ['אלה עוז', 'אלה עוז (אמה נועה)'].sort())
})

// Value: protects=when both the exact name and a fuller spelling are priced, the exact key's price is used; fails_when=the exact-match-first term is dropped from the sort, so localeCompare picks "✨ ענבר" (symbols sort first); why_new=existing tests have only one priced spelling; seam=none
Deno.test('resolveSavedStudent: an exact priced key beats a fuller priced spelling', () => {
  const custom = {
    '✨ ענבר': { '60': 300, '45': 250, '30': 200 },
    'ענבר': { '60': 230, '45': 200, '30': 180 },
  }
  assertEquals(resolveSavedStudent('ענבר', custom, {}), { key: 'ענבר', aliases: ['✨ ענבר'] })
})

Deno.test('resolveSavedStudent: no saved match keeps the parsed name', () => {
  assertEquals(resolveSavedStudent('דנה לוי', { 'דנה כהן': {} }, {}), { key: 'דנה לוי', aliases: [] })
})

Deno.test('calculatePayments: custom price saved under a fuller name applies (ענבר at 230, not 200)', () => {
  const events = [
    makeLessonEvent('ענבר (11.5) אמא עינת - פיתוח קול', '2026-10-05T10:00:00Z', '2026-10-05T10:45:00Z'),
  ]
  const config = {
    ...BASE_CONFIG,
    student_name_regex: '^([^-|:]+)',
    custom_prices: { 'ענבר 11.5 (אמא עינת)': { regular: { '45': 230 }, non_regular: { '45': 230 } } },
  }
  const { rows } = calculatePayments(events, config, '2026-10')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].student, 'ענבר 11.5 (אמא עינת)')
  assertEquals(rows[0].amount_due, 230)
})

Deno.test('calculatePayments: two saved spellings of one student produce a single row', () => {
  const events = [
    makeLessonEvent('אלה עוז (9.5) - פיתוח קול ✨ אמא נועה', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
    makeLessonEvent('אלה עוז (אמה נועה) פיתוח קול', '2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z'),
  ]
  const config = {
    ...BASE_CONFIG,
    student_name_regex: '^([^-|:]+)',
    custom_prices: { 'אלה עוז (9.5)': { '60': 240, '45': 200, '30': 180 } },
    customer_details: { 'אלה עוז (אמה נועה)': { phone: '050-1234567' } },
  }
  const { rows } = calculatePayments(events, config, '2026-10')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].student, 'אלה עוז (9.5)')
  assertEquals(rows[0].lessons_60, 2)
  assertEquals(rows[0].amount_due, 480)
  assertEquals(rows[0].aliases.includes('אלה עוז (אמה נועה)'), true)
})

// ── configurable lesson keywords ──────────────────────────────────────────────

Deno.test('isTargetLesson: honours configured keywords', () => {
  const keywords = ['פיתוח קול', 'כתיבה והלחנה']
  assertEquals(isTargetLesson('נועה - כתיבה והלחנה', keywords), true)
  assertEquals(isTargetLesson('נועה - כתיבה והלחנה'), false)
  assertEquals(isTargetLesson('נועה - פיתוח קול', []), false)
})

Deno.test('calculatePayments: counts lessons for an added keyword and cuts the name around it', () => {
  const events = [
    makeLessonEvent('כתיבה והלחנה רותם כהן', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
    makeLessonEvent('דנה לוי פיתוח קול', '2026-10-06T10:00:00Z', '2026-10-06T11:00:00Z'),
  ]
  const config = { ...BASE_CONFIG, lesson_keywords: ['פיתוח קול', 'כתיבה והלחנה'] }
  const { rows } = calculatePayments(events, config, '2026-10')
  assertEquals(rows.map(r => r.student).sort(), ['דנה לוי', 'רותם כהן'].sort())
})

// Value: protects=custom lesson keywords reach the separator and regex branches of name parsing; fails_when=lessonKeywords is not passed to nameAroundLessonPhrase in either branch, so a keyword-first title bills a student named "כתיבה והלחנה"; why_new=the added-keyword calculatePayments test uses a title with no separator and no regex; seam=none
Deno.test('inferStudentName: custom keyword before the name is skipped in separator and regex titles', () => {
  const keywords = ['פיתוח קול', 'כתיבה והלחנה']
  assertEquals(inferStudentName('כתיבה והלחנה - רותם כהן', null, [], keywords), 'רותם כהן')
  assertEquals(inferStudentName('כתיבה והלחנה רותם כהן | 9.5', '^([^|]+)', [], keywords), 'רותם כהן')
})

// ── non-standard durations surface for review ─────────────────────────────────

// Value: protects=an event with no end dateTime becomes a review item with minutes null and prices to 0, never NaN; fails_when=eventMinutes loses its end guard (NaN minutes) or proRataPrice/base stop defaulting null minutes, turning the row total and "Prepare all" amount into NaN; why_new=all review-item tests use timed events with an end; seam=none
Deno.test('calculatePayments: an event without an end time is a review item with null minutes that prices to 0', () => {
  const events = [{ id: 'evt1', summary: 'רותם כהן - פיתוח קול', start: { dateTime: '2026-10-05T10:00:00Z' }, end: { date: '2026-10-05' } }]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-10')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].review_items[0].minutes, null)
  const prices = BASE_CONFIG.prices.non_regular
  for (const mode of ['prorata', 'base']) {
    const resolutions = { [`2026-10:רותם כהן:evt1`]: { mode } }
    assertEquals(computeRowAmount(rows[0], prices, resolutions, '2026-10'), { amount: 0, extra: 0, unresolved: 0 })
  }
})


Deno.test('calculatePayments: a 75-min add-on is surfaced for review, not silently dropped', () => {
  const events = [
    { id: 'evt1', summary: 'יובל חייט פיתוח קול - תוספת 15 דק השלמה', start: { dateTime: '2026-10-05T10:00:00Z' }, end: { dateTime: '2026-10-05T11:15:00Z' } },
    makeLessonEvent('יובל חייט פיתוח קול', '2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z'),
  ]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-10')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].lessons_60, 1)
  assertEquals(rows[0].review_items.length, 1)
  assertEquals(rows[0].review_items[0].id, 'evt1')
  assertEquals(rows[0].review_items[0].minutes, 75)
  assertEquals(rows[0].review_items[0].auto, null)
})

Deno.test('calculatePayments: a student whose only event is non-standard still gets a row', () => {
  const events = [makeLessonEvent('רותם כהן - פיתוח קול', '2026-10-05T10:00:00Z', '2026-10-05T10:15:00Z')]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-10')
  assertEquals(rows.length, 1)
  assertEquals(rows[0].amount_due, 0)
  assertEquals(rows[0].review_items.length, 1)
  // Value: protects=an id-less event still gets a stable per-event review key (its start time); fails_when=id fallback dropped, so answers key on "undefined" and collide; why_new=existing tests only assert id when event.id is set; seam=none
  assertEquals(rows[0].review_items[0].id, '2026-10-05T10:00:00Z')
  assertEquals(rows[0].review_items[0].minutes, 15)
})

// Value: protects=with overlapping keywords the name is cut around the longest one; fails_when=keyword sort removed, so "פיתוח קול" matches first and the name becomes "מתקדם דנה"; why_new=keyword tests use non-overlapping keywords; seam=none
Deno.test('calculatePayments: overlapping lesson keywords cut the name around the longest one', () => {
  const events = [makeLessonEvent('פיתוח קול מתקדם דנה לוי', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z')]
  const config = { ...BASE_CONFIG, lesson_keywords: ['פיתוח קול', 'פיתוח קול מתקדם'] }
  const { rows } = calculatePayments(events, config, '2026-10')
  assertEquals(rows.map(r => r.student), ['דנה לוי'])
})

// Value: protects=a blank keyword/make-up phrase in Settings never matches every title; fails_when=the empty-string filter is dropped ('x'.includes('') is true), billing every event / auto-resolving all; why_new=no test feeds blank entries; seam=none
Deno.test('calculatePayments: blank lesson keywords and make-up phrases are ignored', () => {
  assertEquals(isTargetLesson('דנה - שיעור פסנתר', ['', null]), false)
  const events = [
    makeLessonEvent('דנה - שיעור פסנתר', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
    makeLessonEvent('רותם כהן - פיתוח קול', '2026-10-06T10:00:00Z', '2026-10-06T11:15:00Z'),
  ]
  const config = { ...BASE_CONFIG, lesson_keywords: ['', 'פיתוח קול'], makeup_phrases: [''] }
  const { rows } = calculatePayments(events, config, '2026-10')
  assertEquals(rows.map(r => r.student), ['רותם כהן'])
  assertEquals(rows[0].review_items[0].auto, null)
})

Deno.test('calculatePayments: a make-up phrase from Settings resolves the item automatically', () => {
  const events = [makeLessonEvent('רותם כהן - פיתוח קול השלמה', '2026-10-05T10:00:00Z', '2026-10-05T11:15:00Z')]
  const { rows } = calculatePayments(events, { ...BASE_CONFIG, makeup_phrases: ['השלמה'] }, '2026-10')
  assertEquals(rows[0].review_items[0].auto, 'base')
})

Deno.test('calculatePayments: non-standard events outside the month are not surfaced', () => {
  const events = [makeLessonEvent('רותם כהן - פיתוח קול', '2026-09-05T10:00:00Z', '2026-09-05T10:15:00Z')]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-10')
  assertEquals(rows.length, 0)
})

// Value: protects=all-day and nameless lesson events never become bogus rows/review items; fails_when=the parsed-name/start.dateTime skip moves after the review branch; why_new=guard moved earlier in this diff; seam=none
Deno.test('calculatePayments: an all-day lesson event and a title with no parsable name yield no row or review item', () => {
  const events = [
    makeLessonEvent('דנה - פיתוח קול', '2026-02-02T10:00:00.000Z', '2026-02-02T11:00:00.000Z'),
    // All-day: start.date only, no start.dateTime.
    { id: 'all-day', summary: 'דנה - פיתוח קול', start: { date: '2026-02-09' }, end: { date: '2026-02-10' } },
    // Stripping the paid-cancellation phrase leaves no name; 75 min would otherwise be a review item.
    { id: 'nameless', summary: 'ביטול בתשלום פיתוח קול', start: { dateTime: '2026-02-16T10:00:00.000Z' }, end: { dateTime: '2026-02-16T11:15:00.000Z' } },
  ]
  const config = { ...BASE_CONFIG, paid_cancellation_phrases: ['ביטול בתשלום פיתוח קול'] }
  const { rows } = calculatePayments(events, config, '2026-02')
  assertEquals(rows.map(r => r.student), ['דנה'])
  assertEquals(rows[0].lessons_60, 1)
  assertEquals(rows[0].review_items, [])
})

// ── review items vs regularity, paid cancellations, make-up auto range ───────

// Value: protects=a weekly student with one non-standard lesson keeps the regular rate; fails_when=review items are left out of the regularity dates (non_regular, 3x270 instead of 3x250); why_new=regularity tests use standard lengths only; seam=none
Deno.test('calculatePayments: a non-standard-length lesson still counts toward weekly regularity', () => {
  const events = [
    makeLessonEvent('דנה לוי - פיתוח קול', '2026-02-02T10:00:00Z', '2026-02-02T11:00:00Z'),
    makeLessonEvent('דנה לוי - פיתוח קול', '2026-02-09T10:00:00Z', '2026-02-09T11:00:00Z'),
    { id: 'x', summary: 'דנה לוי - פיתוח קול השלמה', start: { dateTime: '2026-02-16T10:00:00Z' }, end: { dateTime: '2026-02-16T11:15:00Z' } },
    makeLessonEvent('דנה לוי - פיתוח קול', '2026-02-23T10:00:00Z', '2026-02-23T11:00:00Z'),
  ]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-02')
  assertEquals(rows[0].student_type, 'regular')
  assertEquals(rows[0].amount_due, 3 * BASE_CONFIG.prices.regular['60'])
  assertEquals(rows[0].review_items.length, 1)
})

// Value: protects=a paid cancellation of non-standard length still bills at the regular rate; fails_when=forceRegular is set only after the review-item branch; why_new=paid-cancellation tests use 60-min events; seam=none
Deno.test('calculatePayments: a non-standard-length paid cancellation still forces the regular tier', () => {
  const events = [{ id: 'y', summary: 'רותם כהן - פיתוח קול ביטול בתשלום', start: { dateTime: '2026-10-05T10:00:00Z' }, end: { dateTime: '2026-10-05T11:15:00Z' } }]
  const { rows } = calculatePayments(events, BASE_CONFIG, '2026-10')
  assertEquals(rows[0].review_items.length, 1)
  assertEquals(rows[0].student_type, 'regular')
})

// Value: protects=the make-up rule only auto-prices one lesson plus a short add-on; fails_when=the 30-89 min bound is removed (135-min block billed as one lesson, 20-min as 0, unreviewed); why_new=the make-up test uses 75 min only; seam=none
Deno.test('calculatePayments: make-up phrases auto-resolve only 30-89 minute events', () => {
  const ev = (id, start, end) => ({ id, summary: 'רותם כהן - פיתוח קול השלמה', start: { dateTime: start }, end: { dateTime: end } })
  const events = [
    ev('m75', '2026-10-05T10:00:00Z', '2026-10-05T11:15:00Z'),
    ev('m135', '2026-10-12T10:00:00Z', '2026-10-12T12:15:00Z'),
    ev('m20', '2026-10-19T10:00:00Z', '2026-10-19T10:20:00Z'),
  ]
  const { rows } = calculatePayments(events, { ...BASE_CONFIG, makeup_phrases: ['השלמה'] }, '2026-10')
  const byId = Object.fromEntries(rows[0].review_items.map(i => [i.id, i]))
  assertEquals(byId.m75.auto, 'base')
  assertEquals(byId.m135.auto, null)
  assertEquals(byId.m20.auto, null)
  assertEquals([byId.m75.makeup, byId.m135.makeup, byId.m20.makeup], [true, true, true])
})

// ── same-name safety check ────────────────────────────────────────────────────

// Value: protects=two different students sharing a first name are flagged, the same student split across keys is not; fails_when=conflict detection is removed or compares only one field; why_new=savedNameConflicts is new; seam=none
Deno.test('savedNameConflicts: flags contradicting phones, names or prices, not complementary details', () => {
  const custom = { 'ענבר 11.5 (אמא עינת)': { '60': 230, '45': 200, '30': 180 }, 'ענבר 3.2 (אמא רות)': { '60': 250, '45': 200, '30': 180 } }
  const details = { 'ענבר 11.5 (אמא עינת)': { phone: '050-1111111' }, 'ענבר 3.2 (אמא רות)': { phone: '050-2222222', full_name: 'ענבר לוי' } }
  assertEquals(savedNameConflicts(['ענבר 11.5 (אמא עינת)', 'ענבר 3.2 (אמא רות)'], custom, details), ['phone', 'price'])
  // אלה עוז: price under one spelling, phone under the other -> one student
  assertEquals(savedNameConflicts(['אלה עוז (9.5)', 'אלה עוז (אמה נועה)'], { 'אלה עוז (9.5)': { '60': 240 } }, { 'אלה עוז (אמה נועה)': { phone: '050-1234567' } }), [])
})

// Value: protects=a merged row carries its conflicts so the UI can block sending; fails_when=calculatePayments stops attaching name_conflicts; why_new=new field; seam=none
Deno.test('calculatePayments: a row built from contradicting saved spellings carries name_conflicts', () => {
  const events = [makeLessonEvent('ענבר - פיתוח קול', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z')]
  const config = {
    ...BASE_CONFIG,
    custom_prices: { 'ענבר 11.5 (אמא עינת)': { '60': 230, '45': 200, '30': 180 } },
    customer_details: { 'ענבר 11.5 (אמא עינת)': { phone: '050-1111111' }, 'ענבר 3.2 (אמא רות)': { phone: '050-2222222' } },
  }
  const { rows } = calculatePayments(events, config, '2026-10')
  assertEquals(rows[0].name_conflicts, ['phone'])
})

// ── normalized conflicts and recalculation (Codex review, cycle 3) ───────────

// Value: protects=the same phone typed two ways, or the same price written flat vs tiered, is not flagged as two students; fails_when=raw values are compared, blocking sending for one student; why_new=conflict tests used distinct values only; seam=none
Deno.test('savedNameConflicts: equivalent phones, names and prices are not conflicts', () => {
  const details = { 'אלה עוז (9.5)': { phone: '050-1234567', full_name: 'נועה  עוז' }, 'אלה עוז (אמה נועה)': { phone: '0501234567', full_name: 'נועה עוז' } }
  const custom = { 'אלה עוז (9.5)': { '60': 240, '45': 200, '30': 180 }, 'אלה עוז (אמה נועה)': { regular: { '60': 240, '45': 200, '30': 180 } } }
  assertEquals(savedNameConflicts(['אלה עוז (9.5)', 'אלה עוז (אמה נועה)'], custom, details), [])
  assertEquals(savedNameConflicts(['a', 'b'], { a: { '60': 240 }, b: { '60': 250 } }, {}), ['price'])
  assertEquals(savedNameConflicts(['a', 'b'], { a: { regular: {}, non_regular: {} }, b: { '60': 250 } }, {}), [])
})

// Value: protects=a conflicting spelling added after Calculate pauses sending until recalculation; fails_when=only the row key is compared, so the stale conflict-free row can be billed; why_new=rowNeedsRecalc is new; seam=none
Deno.test('rowNeedsRecalc: flags a row whose spellings or conflicts changed since Calculate', () => {
  const custom = { 'ענבר 11.5 (אמא עינת)': { '60': 230, '45': 200, '30': 180 } }
  const details = { 'ענבר 11.5 (אמא עינת)': { phone: '050-1111111' } }
  const events = [makeLessonEvent('ענבר - פיתוח קול', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z')]
  const [row] = calculatePayments(events, { ...BASE_CONFIG, custom_prices: custom, customer_details: details }, '2026-10').rows
  assertEquals(rowNeedsRecalc(row, custom, details), false)
  // A second ענבר with another phone is saved afterwards: same key, new alias and a conflict.
  const later = { ...details, 'ענבר 3.2 (אמא רות)': { phone: '050-2222222' } }
  assertEquals(rowNeedsRecalc(row, custom, later), true)
  // A phone saved from the table under the row's own key changes nothing.
  assertEquals(rowNeedsRecalc(row, custom, { 'ענבר 11.5 (אמא עינת)': { phone: '050-1111111', full_name: 'עינת שמש' } }), false)
})
