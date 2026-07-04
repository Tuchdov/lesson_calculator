import { assertEquals, assertFalse } from '@std/assert'
import {
  calculatePayments,
  doubleLessonDurationMinutes,
  inferStudentName,
  isCancelledLesson,
  isPaidCancellation,
  isRegular,
  isTargetLesson,
  lessonDurationMinutes,
  normalizeStudentName,
  resolvePriceTable,
} from '../src/lib/calendarPayments.js'

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
Deno.test('isPaidCancellation: Hebrew phrase detected / not detected', () => {
  assertEquals(isPaidCancellation('ליאור פיתוח קול ביטול בתשלום'), true)
  assertEquals(isPaidCancellation('ביטול בתשלום פיתוח קול'), true)
  assertFalse(isPaidCancellation('ליאור פיתוח קול'))
  assertFalse(isPaidCancellation('Alice - lesson cancelled'))
})

// 14
Deno.test('inferStudentName: strips lesson phrase + parenthetical tokens', () => {
  assertEquals(inferStudentName('רותם עצמון (14) פיתוח קול שיעור ראשון ✨ אמא אנדראה'), 'רותם עצמון')
  assertEquals(inferStudentName('רותם עצמון (14) פיתוח קול ✨ אמא אנדראה'), 'רותם עצמון')
  assertEquals(inferStudentName('ליאור פיתוח קול ביטול בתשלום'), 'ליאור')
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
