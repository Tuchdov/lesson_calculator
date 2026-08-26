import { assertEquals } from '@std/assert'
import { resolveRowPrices, computeLessonAmount } from '../src/lib/rowPricing.js'

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
