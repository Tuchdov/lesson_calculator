import { assertEquals } from '@std/assert'
import { loadCalculation, saveCalculation } from '../src/lib/calculationStore.js'

function makeStub() {
  const map = new Map()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
}

const calculation = {
  rows: [{ student: 'Alice', student_type: 'regular', lessons_60: 2, lessons_45: 0, lessons_30: 0, review_items: [] }],
  summary: { month: '2026-03', students: 1, total_amount_due: 400 },
  calculatedWith: { calendar_id: 'primary' },
}

// Value: protects=a calculated table survives closing the site and comes back for the same account only; fails_when=the store keys by something other than the account, or drops a field the table needs; why_new=calculation used to live only in memory; seam=storage stub
Deno.test('saveCalculation + loadCalculation: round-trips per account', async () => {
  const stub = makeStub()
  await saveCalculation('a@example.com', calculation, stub)
  assertEquals(await loadCalculation('a@example.com', stub), calculation)
  assertEquals(await loadCalculation('b@example.com', stub), null)
})

Deno.test('loadCalculation: unreadable or malformed data loads as nothing', async () => {
  const stub = makeStub()
  await saveCalculation('a@example.com', calculation, stub)
  const [key] = stub.map.keys()
  stub.setItem(key, '{not json')
  assertEquals(await loadCalculation('a@example.com', stub), null)
  stub.setItem(key, JSON.stringify({ rows: 'x', summary: {} }))
  assertEquals(await loadCalculation('a@example.com', stub), null)
})
