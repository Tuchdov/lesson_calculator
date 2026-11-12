import { resolvePriceTable, normalizeStudentName } from './calendarPayments.js'
import { invoiceRecord, invoiceRecordNames } from './payments.js'

/**
 * Shared between EditableTable (per-row rendering) and CalculatorPage
 * (prepare-all needs each row's amount without opening every row). Kept out of
 * EditableTable.jsx itself so that file can stay component-only for React Fast
 * Refresh.
 *
 * Delegates to calendarPayments.js's resolvePriceTable (the same function
 * calculatePayments uses for the row's own amount_due) rather than
 * re-implementing the resolution rules — a second copy previously accepted a
 * flat custom price missing '45'/'30', producing a NaN amount that silently
 * dropped the student from "Prepare all links".
 * @param {string} student Saved student key.
 * @param {boolean} regular Whether the regular tier applies.
 * @param {object} config Config with default `prices`.
 * @param {object} [custom] The student's saved price.
 * @returns {object} Prices per duration.
 */
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

/**
 * The tier the row is billed at: the teacher's per-month choice (e.g. a
 * discount granted to a student who didn't qualify) wins over the calculated
 * one.
 * @param {object} row A calculated student row.
 * @param {object} tierOverrides Saved tier choices by invoice.
 * @param {string} month Month key.
 * @returns {string} "regular" or "non_regular".
 */
export function effectiveStudentType(row, tierOverrides, month) {
  return invoiceRecord(tierOverrides, month, row) ?? row.student_type
}

/**
 * The counted lessons times their prices, rounded to cents (review items not
 * included).
 * @param {object} row A calculated student row.
 * @param {object} prices Per-lesson prices for the row's tier.
 * @returns {number} The amount.
 */
export function computeLessonAmount(row, prices) {
  const amount = row.lessons_60 * Number(prices['60'])
    + row.lessons_45 * Number(prices['45'])
    + row.lessons_30 * Number(prices['30'])
  return Math.round(amount * 100) / 100
}

// --- Review items (lessons with a non-standard duration) -------------------
// calculatePayments leaves these out of the lesson counts; the teacher picks
// how each one is charged and the answer is stored per invoice.

/**
 * Storage key of the answer for one review item.
 * @param {string} month Month key.
 * @param {string} student Student key.
 * @param {string} itemId Review item (event) id.
 * @returns {string} "{month}:{student}:{itemId}".
 */
export function reviewKey(month, student, itemId) {
  return `${month}:${student}:${itemId}`
}

/**
 * The longest standard lesson that fits inside the event — what a make-up
 * add-on ("60 min + 15 min השלמה") charges, the extra minutes being free.
 * @param {number} minutes Length of the event.
 * @param {object} prices Per-lesson prices for the row's tier.
 * @returns {number} The price, or 0 when it is under 30 minutes.
 */
export function baseLessonPrice(minutes, prices) {
  const tier = ['60', '45', '30'].find(d => minutes >= Number(d))
  return tier ? Number(prices[tier]) : 0
}

/**
 * The event's minutes at the 60-minute rate, rounded to cents.
 * @param {number} minutes Length of the event.
 * @param {object} prices Per-lesson prices for the row's tier.
 * @returns {number} The price.
 */
export function proRataPrice(minutes, prices) {
  return Math.round((Math.max(minutes ?? 0, 0) / 60) * Number(prices['60']) * 100) / 100
}

/**
 * Only the teacher's saved answer (under any spelling), never the automatic
 * make-up one.
 * @param {object} item A review item.
 * @param {object} resolutions Saved answers.
 * @param {string} month Month key.
 * @param {object} row A calculated student row.
 * @returns {object | null} The saved answer.
 */
export function storedReviewResolution(item, resolutions, month, row) {
  return invoiceRecord(resolutions, month, row, `:${item.id}`)
}

/**
 * Every student name a stored answer lives under (the row's own key or older
 * spellings), so clearing it removes all of them.
 * @param {object} item A review item.
 * @param {object} resolutions Saved answers.
 * @param {string} month Month key.
 * @param {object} row A calculated student row.
 * @returns {string[]} Student names with an answer saved.
 */
export function storedReviewNames(item, resolutions, month, row) {
  return invoiceRecordNames(resolutions, month, row, `:${item.id}`)
}

/**
 * A stored answer wins; otherwise a make-up phrase from Settings resolves the
 * item automatically. Anything else is unresolved.
 * @param {object} item A review item.
 * @param {object} resolutions Saved answers.
 * @param {string} month Month key.
 * @param {object} row A calculated student row.
 * @returns {{mode: string, amount?: number} | null} The answer that applies, or
 *   null.
 */
export function reviewResolution(item, resolutions, month, row) {
  return storedReviewResolution(item, resolutions, month, row) ?? (item.auto ? { mode: item.auto } : null)
}

/**
 * What one review item adds to the invoice under an answer.
 * @param {object} item A review item.
 * @param {object | null} resolution The answer.
 * @param {object} prices Per-lesson prices for the row's tier.
 * @returns {number} The amount; 0 for "free" or no answer.
 */
export function reviewItemAmount(item, resolution, prices) {
  switch (resolution?.mode) {
    case 'prorata': return proRataPrice(item.minutes, prices)
    case 'base': return baseLessonPrice(item.minutes ?? 0, prices)
    case 'fixed': return Number(resolution.amount) || 0
    default: return 0
  }
}

/**
 * Lesson amount plus every resolved review item, and how many are still
 * unresolved (a row with any unresolved item must not be billed). The final
 * amount is always rounded up to a whole shekel (802.4 → 803); it is rounded to
 * cents first so float noise like 802.0000000001 doesn't bump it to 803.
 * @param {object} row A calculated student row.
 * @param {object} prices Per-lesson prices for the row's tier.
 * @param {object} resolutions Saved review answers.
 * @param {string} month Month key.
 * @returns {{amount: number, extra: number, unresolved: number}} Whole-shekel
 *   amount, what review items add, and how many are open.
 */
export function computeRowAmount(row, prices, resolutions, month) {
  let extra = 0
  let unresolved = 0
  for (const item of row.review_items ?? []) {
    const resolution = reviewResolution(item, resolutions, month, row)
    if (!resolution) unresolved++
    else extra += reviewItemAmount(item, resolution, prices)
  }
  const amount = Math.ceil(Math.round((computeLessonAmount(row, prices) + extra) * 100) / 100)
  return { amount, extra: Math.round(extra * 100) / 100, unresolved }
}

/**
 * The row's own key wins; other spellings of the same student (see
 * resolveSavedStudent) fill whatever it lacks, e.g. a phone saved under "אלה
 * עוז" while the price lives under "אלה עוז (9.5)".
 * @param {object} customerDetails Saved details by student.
 * @param {object} row A calculated student row.
 * @returns {object} The merged details.
 */
export function detailsFor(customerDetails, row) {
  const merged = {}
  // Conflicting spellings are probably different students: never borrow
  // another one's phone or name.
  const keys = row.name_conflicts?.length ? [row.student] : [...(row.aliases ?? []), row.student]
  for (const key of keys) {
    for (const [field, value] of Object.entries(customerDetails?.[key] ?? {})) {
      if (value !== '' && value != null) merged[field] = value
    }
  }
  return merged
}

/**
 * The row with the teacher's lesson counts in place of the calendar's, so the
 * amount, the invoice/WhatsApp lesson count and the CSV all follow them. The
 * calendar's counts stay on `calendar_lessons` for display and reset.
 * @param {object} row A calculated student row with `lessons_60/45/30`.
 * @param {{ '60': number, '45': number, '30': number }} [override] Saved counts;
 *   each is floored and clamped to 0 or more.
 * @returns {object} The same row when there is no override, else a copy with the
 *   overridden counts and `calendar_lessons` holding the originals.
 */
export function applyLessonOverride(row, override) {
  if (!override) return row
  const count = d => Math.max(0, Math.floor(Number(override[d]) || 0))
  return {
    ...row,
    lessons_60: count('60'),
    lessons_45: count('45'),
    lessons_30: count('30'),
    calendar_lessons: { '60': row.lessons_60, '45': row.lessons_45, '30': row.lessons_30 },
  }
}

/**
 * Counted lessons of every length.
 * @param {object} row A calculated student row.
 * @returns {number} The count.
 */
export function totalLessons(row) {
  return row.lessons_60 + row.lessons_45 + row.lessons_30
}

/**
 * The lesson count shown on the invoice and in the WhatsApp message: the
 * regular lessons plus review items charged as a full standard lesson. Extra
 * minutes (pro-rata), fixed amounts and free items add to the amount only.
 * @param {object} row A calculated student row.
 * @param {object} resolutions Saved review answers.
 * @param {string} month Month key.
 * @returns {number} The lesson count.
 */
export function billedLessonCount(row, resolutions, month) {
  const standard = (row.review_items ?? [])
    .filter(item => reviewResolution(item, resolutions, month, row)?.mode === 'base')
    .length
  return totalLessons(row) + standard
}

// Pre-selected answer for an unresolved item. A make-up (a Settings make-up
// phrase, or "השלמה") defaults the extra minutes to free; anything else
// pro-rata.
const MAKEUP_HINT = 'השלמה'
/**
 * The answer pre-selected for an open review item (see MAKEUP_HINT above).
 * @param {object} item A review item.
 * @param {object} prices Per-lesson prices for the row's tier.
 * @returns {string} "prorata", "base" or "free".
 */
export function defaultReviewMode(item, prices) {
  if (!item.makeup && !(item.summary ?? '').includes(MAKEUP_HINT)) return 'prorata'
  return baseLessonPrice(item.minutes ?? 0, prices) > 0 ? 'base' : 'free'
}

/**
 * The student as the calendar names them: the saved key without its notes
 * ("ענבר 11.5 (אמא עינת)" -> "ענבר"). Used where a person reads the name: the
 * Grow product line and the invoice text's {student}.
 * @param {object} row A calculated student row.
 * @returns {string} The name.
 */
export function lessonStudentName(row) {
  return normalizeStudentName(row.student)
}

/**
 * Who pays and receives the invoice: the saved payer name (a child's parent),
 * else the student's own name. A name without first and last part makes the
 * table ask for the payer (hasFullName).
 * @param {object} details The student's saved details.
 * @param {object} row A calculated student row.
 * @returns {string} The payer.
 */
export function payerName(details, row) {
  return details?.full_name || lessonStudentName(row)
}

/**
 * Splits the month's rows into the ones billed and the ones the teacher left
 * out of this month (payments.js saveExcludedStudent), under any spelling.
 * @param {object[]} rows The month's rows.
 * @param {object} excluded Saved exclusions by invoice.
 * @param {string} month Month key.
 * @returns {{kept: object[], removed: object[]}} Rows billed and rows left out.
 */
export function splitExcluded(rows, excluded, month) {
  const kept = []
  const removed = []
  for (const row of rows ?? []) (invoiceRecord(excluded, month, row) ? removed : kept).push(row)
  return { kept, removed }
}
