import { assertEquals } from '@std/assert'
import {
  resolveRowPrices,
  computeLessonAmount,
  baseLessonPrice,
  proRataPrice,
  computeRowAmount,
  reviewKey,
  detailsFor,
  defaultReviewMode,
  totalLessons,
} from '../src/lib/rowPricing.js'
import { invoiceRecord, invoiceRecordName } from '../src/lib/payments.js'

const CONFIG = { prices: { regular: { '60': 260, '45': 210, '30': 190 }, non_regular: { '60': 280, '45': 230, '30': 210 } } }

Deno.test('resolveRowPrices: falls back to config defaults with no custom price', () => {
  assertEquals(resolveRowPrices('Alice', true, CONFIG, undefined), { '60': 260, '45': 210, '30': 190 })
  assertEquals(resolveRowPrices('Alice', false, CONFIG, undefined), { '60': 280, '45': 230, '30': 210 })
})

Deno.test('resolveRowPrices: flat custom price object overrides all durations', () => {
  const custom = { '60': 300, '45': 250, '30': 220 }
  assertEquals(resolveRowPrices('Alice', true, CONFIG, custom), custom)
})

Deno.test('resolveRowPrices: tiered custom price selects by regularity and fills missing durations from defaults', () => {
  const custom = { regular: { '60': 300 } }
  assertEquals(resolveRowPrices('Alice', true, CONFIG, custom), { '60': 300, '45': 210, '30': 190 })
})

Deno.test('resolveRowPrices: tiered custom price falls back to the other tier when the matching one is absent, filling missing durations from the row\'s own tier defaults', () => {
  const custom = { non_regular: { '60': 300 } }
  assertEquals(resolveRowPrices('Alice', true, CONFIG, custom), { '60': 300, '45': 210, '30': 190 })
})

// Regression guard for a code-review finding: an incomplete flat custom price
// (e.g. only the 60-minute field filled in on the Custom Prices page) must
// fall back to config defaults, not be returned as-is with missing durations
// — computeLessonAmount would otherwise multiply by Number(undefined) = NaN,
// silently failing isValidAmount and dropping the student from prepare-all.
Deno.test('resolveRowPrices: an incomplete flat custom price (missing a duration) falls back to defaults instead of producing NaN downstream', () => {
  const custom = { '60': 300 }
  const prices = resolveRowPrices('Alice', true, CONFIG, custom)
  assertEquals(prices, { '60': 260, '45': 210, '30': 190 })
  const amount = computeLessonAmount({ lessons_60: 1, lessons_45: 1, lessons_30: 0 }, prices)
  assertEquals(Number.isFinite(amount), true)
})

Deno.test('computeLessonAmount: sums lessons across all three durations', () => {
  const row = { lessons_60: 2, lessons_45: 1, lessons_30: 0 }
  const prices = { '60': 260, '45': 210, '30': 190 }
  assertEquals(computeLessonAmount(row, prices), 2 * 260 + 1 * 210)
})

Deno.test('computeLessonAmount: rounds to 2 decimal places', () => {
  const row = { lessons_60: 1, lessons_45: 0, lessons_30: 0 }
  const prices = { '60': 100.005, '45': 0, '30': 0 }
  assertEquals(computeLessonAmount(row, prices), 100.01)
})

Deno.test('computeLessonAmount: zero lessons yields zero', () => {
  const row = { lessons_60: 0, lessons_45: 0, lessons_30: 0 }
  const prices = { '60': 260, '45': 210, '30': 190 }
  assertEquals(computeLessonAmount(row, prices), 0)
})

// Value: protects=number_of_lessons sent to Make and the WhatsApp {lessons} token; fails_when=a duration tier is dropped from the sum (30-min-only student reports 0); why_new=totalLessons is new; seam=none
Deno.test('totalLessons: counts every duration tier, including a 30-min-only row', () => {
  assertEquals(totalLessons({ lessons_60: 1, lessons_45: 2, lessons_30: 4 }), 7)
  assertEquals(totalLessons({ lessons_60: 0, lessons_45: 0, lessons_30: 3 }), 3)
  assertEquals(totalLessons({ lessons_60: 0, lessons_45: 0, lessons_30: 0 }), 0)
})

// ── review items ────────────────────────────────────────────────────────────

const PRICES = { '60': 240, '45': 200, '30': 180 }

Deno.test('baseLessonPrice: the longest standard lesson inside the event, 0 below 30 min', () => {
  assertEquals(baseLessonPrice(75, PRICES), 240)
  assertEquals(baseLessonPrice(50, PRICES), 200)
  assertEquals(baseLessonPrice(15, PRICES), 0)
})

Deno.test('proRataPrice: minutes over 60 of the 60-min price', () => {
  assertEquals(proRataPrice(15, PRICES), 60)
  assertEquals(proRataPrice(75, PRICES), 300)
})

function reviewRow(items) {
  return { student: 'יובל חייט', lessons_60: 1, lessons_45: 0, lessons_30: 0, review_items: items }
}

Deno.test('computeRowAmount: unresolved items add nothing and are counted', () => {
  const row = reviewRow([{ id: 'a', minutes: 15, summary: 'x', auto: null }])
  assertEquals(computeRowAmount(row, PRICES, {}, '2026-10'), { amount: 240, extra: 0, unresolved: 1 })
})

Deno.test('computeRowAmount: applies stored answers per mode', () => {
  const items = [
    { id: 'a', minutes: 15, summary: 'x', auto: null },
    { id: 'b', minutes: 75, summary: 'y', auto: null },
    { id: 'c', minutes: 20, summary: 'z', auto: null },
    { id: 'd', minutes: 10, summary: 'w', auto: null },
  ]
  const resolutions = {
    [reviewKey('2026-10', 'יובל חייט', 'a')]: { mode: 'prorata' },
    [reviewKey('2026-10', 'יובל חייט', 'b')]: { mode: 'base' },
    [reviewKey('2026-10', 'יובל חייט', 'c')]: { mode: 'fixed', amount: 50 },
    [reviewKey('2026-10', 'יובל חייט', 'd')]: { mode: 'free' },
  }
  assertEquals(computeRowAmount(reviewRow(items), PRICES, resolutions, '2026-10'), { amount: 240 + 60 + 240 + 50, extra: 350, unresolved: 0 })
})

// Value: protects=a stored "fixed" answer with a missing or non-numeric amount adds 0 and the row total stays a number; fails_when=the "|| 0" guard in reviewItemAmount is dropped, so Number(undefined)/Number('abc') makes the row amount NaN; why_new=the fixed mode is only tested with a valid amount (50); seam=none
Deno.test('computeRowAmount: a fixed answer with a missing or non-numeric amount adds 0, not NaN', () => {
  const row = reviewRow([{ id: 'a', minutes: 15, summary: 'x', auto: null }, { id: 'b', minutes: 20, summary: 'y', auto: null }])
  const resolutions = {
    [reviewKey('2026-10', 'יובל חייט', 'a')]: { mode: 'fixed' },
    [reviewKey('2026-10', 'יובל חייט', 'b')]: { mode: 'fixed', amount: 'abc' },
  }
  assertEquals(computeRowAmount(row, PRICES, resolutions, '2026-10'), { amount: 240, extra: 0, unresolved: 0 })
})

Deno.test('computeRowAmount: a make-up phrase auto-resolves; a stored answer still wins', () => {
  const row = reviewRow([{ id: 'a', minutes: 75, summary: 'x', auto: 'base' }])
  assertEquals(computeRowAmount(row, PRICES, {}, '2026-10').amount, 480)
  const stored = { [reviewKey('2026-10', 'יובל חייט', 'a')]: { mode: 'free' } }
  assertEquals(computeRowAmount(row, PRICES, stored, '2026-10').amount, 240)
})

Deno.test('computeRowAmount: answers do not leak into another month', () => {
  const row = reviewRow([{ id: 'a', minutes: 15, summary: 'x', auto: null }])
  const stored = { [reviewKey('2026-09', 'יובל חייט', 'a')]: { mode: 'prorata' } }
  assertEquals(computeRowAmount(row, PRICES, stored, '2026-10').unresolved, 1)
})

Deno.test('defaultReviewMode: "השלמה" defaults the extra minutes to free, else pro-rata', () => {
  assertEquals(defaultReviewMode({ summary: 'פיתוח קול - תוספת 15 דק השלמה', minutes: 75 }, PRICES), 'base')
  assertEquals(defaultReviewMode({ summary: 'השלמה', minutes: 15 }, PRICES), 'free')
  assertEquals(defaultReviewMode({ summary: 'תוספת', minutes: 15 }, PRICES), 'prorata')
})

// ── detailsFor ──────────────────────────────────────────────────────────────

Deno.test('detailsFor: merges details split across spellings, the row key winning', () => {
  const details = {
    'אלה עוז (9.5)': { full_name: 'אלה עוז', phone: '' },
    'אלה עוז (אמה נועה)': { phone: '050-1234567', full_name: 'ignored' },
  }
  const row = { student: 'אלה עוז (9.5)', aliases: ['אלה עוז (אמה נועה)'] }
  assertEquals(detailsFor(details, row), { phone: '050-1234567', full_name: 'אלה עוז' })
})

// ── conflicts, aliases and make-up hint ──────────────────────────────────────

// Value: protects=a row with contradicting spellings never borrows another student's phone; fails_when=detailsFor merges aliases regardless of name_conflicts; why_new=the merge test has no conflict; seam=none
Deno.test('detailsFor: a row with name conflicts uses only its own saved details', () => {
  const details = { 'ענבר 11.5 (אמא עינת)': { full_name: 'ענבר שמש' }, 'ענבר 3.2 (אמא רות)': { phone: '050-2222222', full_name: 'ענבר לוי' } }
  const row = { student: 'ענבר 11.5 (אמא עינת)', aliases: ['ענבר 3.2 (אמא רות)'], name_conflicts: ['full_name'] }
  assertEquals(detailsFor(details, row), { full_name: 'ענבר שמש' })
})

// Value: protects=links/adjustments/answers saved under an alias or an older parse are still found; fails_when=lookups use row.student only, so Prepare all mints a second link after a rename; why_new=invoiceRecord is new; seam=none
Deno.test('invoiceRecord: finds a record under the row key, an alias, or an older spelling; not across conflicts', () => {
  const links = { '2026-10:ענבר אמא': { link: 'https://pay/old', amount: 230 } }
  const row = { student: 'ענבר 11.5 (אמא עינת)', aliases: ['ענבר'] }
  assertEquals(invoiceRecord(links, '2026-10', row), { link: 'https://pay/old', amount: 230 })
  assertEquals(invoiceRecordName(links, '2026-10', row), 'ענבר אמא')
  assertEquals(invoiceRecord(links, '2026-11', row), null)
  assertEquals(invoiceRecord({ ...links, '2026-10:ענבר 11.5 (אמא עינת)': { link: 'https://pay/new', amount: 230 } }, '2026-10', row).link, 'https://pay/new')
  assertEquals(invoiceRecord(links, '2026-10', { ...row, name_conflicts: ['phone'] }), null)
})

// Value: protects=a review answer saved under the old row name still prices the item; fails_when=review answers are looked up by row.student only; why_new=answers were keyed by the parsed name before this change; seam=none
Deno.test('computeRowAmount: a review answer saved under an alias still applies', () => {
  const row = { student: 'יובל חייט', aliases: ['יובל'], lessons_60: 1, lessons_45: 0, lessons_30: 0, review_items: [{ id: 'a', minutes: 15, summary: 'x', auto: null }] }
  const stored = { [reviewKey('2026-10', 'יובל', 'a')]: { mode: 'prorata' } }
  assertEquals(computeRowAmount(row, PRICES, stored, '2026-10'), { amount: 300, extra: 60, unresolved: 0 })
})

// Value: protects=Settings make-up phrases drive the pre-selected answer; fails_when=defaultReviewMode ignores item.makeup; why_new=only the built-in hint was tested; seam=none
Deno.test('defaultReviewMode: an item flagged as a make-up by Settings pre-selects the standard lesson', () => {
  assertEquals(defaultReviewMode({ summary: 'פיתוח קול תוספת', minutes: 135, makeup: true }, PRICES), 'base')
  assertEquals(defaultReviewMode({ summary: 'פיתוח קול תוספת', minutes: 135, makeup: false }, PRICES), 'prorata')
})
