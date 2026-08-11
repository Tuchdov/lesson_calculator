import { assertEquals } from '@std/assert'
import {
  normalizeName, normalizePriceCell, normalizeMinutesCell, normalizePhoneCell,
  suggestMapping, findDuplicateMappings, planImport,
} from '../src/lib/importPlanner.js'

const FULL_MAPPING = { name: 0, minutes: 1, regular: 2, nonRegular: 3, phone: 4 }
const HEADER = ['Name', 'Minutes', 'Regular', 'NonRegular', 'Phone']

// ── normalizeName: trim + NFC ──

Deno.test('normalizeName: trims whitespace', () => {
  assertEquals(normalizeName('  Dana  '), 'Dana')
})

Deno.test('normalizeName: NFC-normalizes so NFD and NFC forms match', () => {
  const nfc = 'דנה'.normalize('NFC')
  const nfd = 'דנה'.normalize('NFD')
  assertEquals(normalizeName(nfd), nfc)
})

Deno.test('normalizeName: null/undefined become empty string', () => {
  assertEquals(normalizeName(null), '')
  assertEquals(normalizeName(undefined), '')
})

// ── price normalization ──

Deno.test('normalizePriceCell: strips currency symbols and thousands separators', () => {
  assertEquals(normalizePriceCell('₪250'), 250)
  assertEquals(normalizePriceCell('$1,250'), 1250)
  assertEquals(normalizePriceCell(' 250 '), 250)
})

Deno.test('normalizePriceCell: invalid or empty becomes blank, not zero', () => {
  assertEquals(normalizePriceCell(''), '')
  assertEquals(normalizePriceCell(null), '')
  assertEquals(normalizePriceCell('abc'), '')
})

// ── minutes normalization ──

Deno.test('normalizeMinutesCell: resolves "60 min" / "60 דקות" / "60.0" to "60"', () => {
  assertEquals(normalizeMinutesCell('60 min'), '60')
  assertEquals(normalizeMinutesCell('60 דקות'), '60')
  assertEquals(normalizeMinutesCell('60.0'), '60')
  assertEquals(normalizeMinutesCell(45), '45')
})

Deno.test('normalizeMinutesCell: unrecognized value returns null', () => {
  assertEquals(normalizeMinutesCell('90'), null)
  assertEquals(normalizeMinutesCell(''), null)
  assertEquals(normalizeMinutesCell(null), null)
})

// ── phone normalization ──

Deno.test('normalizePhoneCell: restores leading 0 dropped by Excel numeric storage', () => {
  assertEquals(normalizePhoneCell(501234567), '0501234567')
  assertEquals(normalizePhoneCell('501234567'), '0501234567')
})

Deno.test('normalizePhoneCell: leaves already-formatted or non-matching values untouched', () => {
  assertEquals(normalizePhoneCell('050-123-4567'), '050-123-4567')
  assertEquals(normalizePhoneCell(''), '')
})

// ── synonym precedence ──

Deno.test('suggestMapping: matches non-regular before regular when a header contains both substrings', () => {
  const headers = ['non_regular_60', 'regular_60', 'Name', 'Minutes']
  const mapping = suggestMapping(headers)
  assertEquals(mapping.nonRegular, 0)
  assertEquals(mapping.regular, 1)
})

Deno.test('suggestMapping: recognizes Hebrew synonyms', () => {
  const headers = ['שם', 'דקות', 'מחיר', 'מחיר חד"פ', 'טלפון']
  const mapping = suggestMapping(headers)
  assertEquals(mapping.name, 0)
  assertEquals(mapping.minutes, 1)
  assertEquals(mapping.nonRegular, 3)
  assertEquals(mapping.regular, 2)
  assertEquals(mapping.phone, 4)
})

Deno.test('suggestMapping: unmatched headers return -1', () => {
  const mapping = suggestMapping(['Column A', 'Column B'])
  assertEquals(mapping.name, -1)
  assertEquals(mapping.minutes, -1)
})

// ── duplicate mapping detection ──

Deno.test('findDuplicateMappings: flags two targets mapped to the same column', () => {
  const dupes = findDuplicateMappings({ name: 0, minutes: 1, regular: 1, nonRegular: -1, phone: -1 })
  assertEquals(dupes.sort(), ['minutes', 'regular'])
})

Deno.test('findDuplicateMappings: no duplicates when every mapped target is distinct', () => {
  assertEquals(findDuplicateMappings(FULL_MAPPING), [])
})

// ── row skips ──

Deno.test('planImport: empty name skips the row', () => {
  const rows = [HEADER, ['', '60', '250', '', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.counts.skippedRows, 1)
  assertEquals(result.skipDetails[0].reason, 'empty name')
  assertEquals(result.entries, {})
})

Deno.test('planImport: reserved name (__proto__) skips the row', () => {
  const rows = [HEADER, ['__proto__', '60', '250', '', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.counts.skippedRows, 1)
  assertEquals(result.skipDetails[0].reason, 'reserved name')
  assertEquals(Object.prototype.hasOwnProperty.call(result.entries, '__proto__'), false)
})

Deno.test('planImport: unrecognized minutes skips the row', () => {
  const rows = [HEADER, ['Alice', '90', '250', '', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.counts.skippedRows, 1)
  assertEquals(result.skipDetails[0].reason, 'unrecognized minutes')
})

Deno.test('planImport: no price mapped/provided skips the row', () => {
  const rows = [HEADER, ['Alice', '60', '', '', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.counts.skippedRows, 1)
  assertEquals(result.skipDetails[0].reason, 'no price')
})

// ── row pivot ──

Deno.test('planImport: single-row student produces one tiered entry with only that duration filled', () => {
  const rows = [HEADER, ['Alice', '60', '250', '270', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.entries, { Alice: { regular: { '60': 250 }, non_regular: { '60': 270 } } })
})

Deno.test('planImport: multi-row student fills both durations in one entry', () => {
  const rows = [
    HEADER,
    ['Alice', '60', '250', '270', ''],
    ['Alice', '45', '200', '220', ''],
  ]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.entries, {
    Alice: { regular: { '60': 250, '45': 200 }, non_regular: { '60': 270, '45': 220 } },
  })
})

Deno.test('planImport: same (student, minutes) twice — last row wins and is counted conflicting', () => {
  const rows = [
    HEADER,
    ['Alice', '60', '250', '270', ''],
    ['Alice', '60', '300', '270', ''],
  ]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.entries.Alice.regular['60'], 300)
  assertEquals(result.counts.conflictingRows, 1)
})

// ── phone handling ──

Deno.test('planImport: valid phone (with restored leading zero) is kept', () => {
  const rows = [HEADER, ['Alice', '60', '250', '', 501234567]]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.phones, { Alice: '0501234567' })
  assertEquals(result.counts.invalidPhones, 0)
})

Deno.test('planImport: invalid phone is dropped and counted, not saved', () => {
  const rows = [HEADER, ['Alice', '60', '250', '', '123']]
  const result = planImport({ rows, mapping: FULL_MAPPING })
  assertEquals(result.phones, {})
  assertEquals(result.counts.invalidPhones, 1)
})

// ── new vs replaced ──

Deno.test('planImport: classifies students against existingKeys (live page state)', () => {
  const rows = [HEADER, ['Alice', '60', '250', '', ''], ['Bob', '60', '250', '', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING, existingKeys: ['Alice'] })
  assertEquals(result.counts.new, 1)
  assertEquals(result.counts.replaced, 1)
  assertEquals(result.newStudents, ['Bob'])
  assertEquals(result.replacedStudents, ['Alice'])
})

// ── calendar reconciliation ──

Deno.test('planImport: flags imported students absent from availableStudents', () => {
  const rows = [HEADER, ['Alice', '60', '250', '', ''], ['Bob', '60', '250', '', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING, availableStudents: ['Bob'] })
  assertEquals(result.unmatchedStudents, ['Alice'])
})

Deno.test('planImport: empty availableStudents suppresses the reconciliation warning entirely', () => {
  const rows = [HEADER, ['Alice', '60', '250', '', '']]
  const result = planImport({ rows, mapping: FULL_MAPPING, availableStudents: [] })
  assertEquals(result.unmatchedStudents, null)
})

// ── count assembly (combined scenario) ──

Deno.test('planImport: assembles all counts together across a mixed file', () => {
  const rows = [
    HEADER,
    ['Alice', '60', '250', '270', ''],   // new
    ['Bob', '45', '200', '', ''],        // replaced (existing)
    ['', '60', '250', '', ''],           // skipped: empty name
    ['Carol', '90', '250', '', ''],      // skipped: unrecognized minutes
    ['Bob', '45', '210', '', ''],        // conflicting with row 2 (same student, minutes)
  ]
  const result = planImport({ rows, mapping: FULL_MAPPING, existingKeys: ['Bob'] })
  assertEquals(result.counts, {
    new: 1,
    replaced: 1,
    skippedRows: 2,
    conflictingRows: 1,
    invalidPhones: 0,
  })
  assertEquals(result.entries.Bob.regular['45'], 210) // last wins
})
