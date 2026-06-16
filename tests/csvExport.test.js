import { assertEquals } from '@std/assert'
import { escapeCsvFormula, safeTotalsCsvBytes } from '../src/lib/csvExport.js'

Deno.test('escapeCsvFormula: prefixes =, +, -, @ with single quote', () => {
  assertEquals(escapeCsvFormula('=SUM(A1)'), "'=SUM(A1)")
  assertEquals(escapeCsvFormula('+100'), "'+100")
  assertEquals(escapeCsvFormula('-50'), "'-50")
  assertEquals(escapeCsvFormula('@cmd'), "'@cmd")
  assertEquals(escapeCsvFormula('normal'), 'normal')
  assertEquals(escapeCsvFormula(''), '')
  assertEquals(escapeCsvFormula(42), 42)
})

Deno.test('safeTotalsCsvBytes: valid CSV bytes with UTF-8 BOM and correct columns', () => {
  const rows = [
    { student: 'Alice', type: 'regular', lessons_60: 4, lessons_45: 0, lessons_30: 0, amount_due: 1000 },
    { student: 'Bob',   type: 'non_regular', lessons_60: 2, lessons_45: 1, lessons_30: 0, amount_due: 750 },
  ]
  const bytes = safeTotalsCsvBytes(rows)
  // UTF-8 BOM is 0xEF 0xBB 0xBF
  assertEquals(bytes[0], 0xEF)
  assertEquals(bytes[1], 0xBB)
  assertEquals(bytes[2], 0xBF)

  const text = new TextDecoder().decode(bytes)
  const lines = text.replace(/^﻿/, '').split('\r\n')
  assertEquals(lines[0], 'student,type,lessons_60,lessons_45,lessons_30,amount_due')
  assertEquals(lines[1], 'Alice,regular,4,0,0,1000')
  assertEquals(lines[2], 'Bob,non_regular,2,1,0,750')
})
