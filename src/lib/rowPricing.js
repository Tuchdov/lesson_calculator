import { resolvePriceTable } from './calendarPayments.js'

// Shared between EditableTable (per-row rendering) and CalculatorPage
// (prepare-all needs each row's amount without opening every row). Kept out
// of EditableTable.jsx itself so that file can stay component-only for
// React Fast Refresh.
//
// Delegates to calendarPayments.js's resolvePriceTable (the same function
// calculatePayments uses for the row's own amount_due) rather than
// re-implementing the resolution rules — a second copy previously accepted
// a flat custom price missing '45'/'30', producing a NaN amount that
// silently dropped the student from "Prepare all links".
export function resolveRowPrices(student, regular, config, custom) {
  const customPrices = custom !== undefined ? { [student]: custom } : undefined
  return resolvePriceTable(
    student,
    regular,
    config?.prices?.regular,
    config?.prices?.non_regular,
    customPrices,
  )
}

export function computeLessonAmount(row, prices) {
  const amount = row.lessons_60 * Number(prices['60'])
    + row.lessons_45 * Number(prices['45'])
    + row.lessons_30 * Number(prices['30'])
  return Math.round(amount * 100) / 100
}

// --- Review items (lessons with a non-standard duration) -------------------
// calculatePayments leaves these out of the lesson counts; the teacher picks
// how each one is charged and the answer is stored per invoice.

export function reviewKey(month, student, itemId) {
  return `${month}:${student}:${itemId}`
}

// The longest standard lesson that fits inside the event — what a make-up
// add-on ("60 min + 15 min השלמה") charges, the extra minutes being free.
export function baseLessonPrice(minutes, prices) {
  const tier = ['60', '45', '30'].find(d => minutes >= Number(d))
  return tier ? Number(prices[tier]) : 0
}

export function proRataPrice(minutes, prices) {
  return Math.round((Math.max(minutes ?? 0, 0) / 60) * Number(prices['60']) * 100) / 100
}

// A stored answer wins; otherwise a make-up phrase from Settings resolves the
// item automatically. Anything else is unresolved.
export function reviewResolution(item, resolutions, month, student) {
  return resolutions?.[reviewKey(month, student, item.id)] ?? (item.auto ? { mode: item.auto } : null)
}

export function reviewItemAmount(item, resolution, prices) {
  switch (resolution?.mode) {
    case 'prorata': return proRataPrice(item.minutes, prices)
    case 'base': return baseLessonPrice(item.minutes ?? 0, prices)
    case 'fixed': return Number(resolution.amount) || 0
    default: return 0
  }
}

// Lesson amount plus every resolved review item, and how many are still
// unresolved (a row with any unresolved item must not be billed).
export function computeRowAmount(row, prices, resolutions, month) {
  let extra = 0
  let unresolved = 0
  for (const item of row.review_items ?? []) {
    const resolution = reviewResolution(item, resolutions, month, row.student)
    if (!resolution) unresolved++
    else extra += reviewItemAmount(item, resolution, prices)
  }
  const amount = Math.round((computeLessonAmount(row, prices) + extra) * 100) / 100
  return { amount, extra: Math.round(extra * 100) / 100, unresolved }
}

// The row's own key wins; other spellings of the same student (see
// resolveSavedStudent) fill whatever it lacks, e.g. a phone saved under
// "אלה עוז" while the price lives under "אלה עוז (9.5)".
export function detailsFor(customerDetails, row) {
  const merged = {}
  for (const key of [...(row.aliases ?? []), row.student]) {
    for (const [field, value] of Object.entries(customerDetails?.[key] ?? {})) {
      if (value !== '' && value != null) merged[field] = value
    }
  }
  return merged
}

export function totalLessons(row) {
  return row.lessons_60 + row.lessons_45 + row.lessons_30
}

// Pre-selected answer for an unresolved item. "השלמה" usually marks a
// make-up, so the extra minutes default to free; anything else pro-rata.
const MAKEUP_HINT = 'השלמה'
export function defaultReviewMode(item, prices) {
  if (!(item.summary ?? '').includes(MAKEUP_HINT)) return 'prorata'
  return baseLessonPrice(item.minutes ?? 0, prices) > 0 ? 'base' : 'free'
}
