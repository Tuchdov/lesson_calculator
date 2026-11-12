const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@']
const CSV_FIELDS = ['student', 'type', 'lessons_60', 'lessons_45', 'lessons_30', 'amount_due', 'status']

/**
 * Prefixes a quote to text a spreadsheet would run as a formula (=, +, -, @).
 * @param {*} value A cell value.
 * @returns {*} The safe value; non-strings unchanged.
 */
export function escapeCsvFormula(value) {
  if (typeof value !== 'string' || !value) return value
  if (CSV_FORMULA_PREFIXES.includes(value[0])) return "'" + value
  return value
}

/**
 * The CSV export of the table rows, formula-safe, with a BOM so Excel reads
 * Hebrew.
 * @param {object[]} rows Rows with student_type, amount_due and status.
 * @returns {Uint8Array} UTF-8 bytes.
 */
export function safeTotalsCsvBytes(rows) {
  const header = CSV_FIELDS.join(',')
  const lines = rows.map(row => {
    const student = escapeCsvFormula(String(row.student ?? ''))
    return [
      csvCell(student),
      csvCell(row.type ?? row.student_type ?? ''),
      row.lessons_60 ?? 0,
      row.lessons_45 ?? 0,
      row.lessons_30 ?? 0,
      row.amount_due ?? 0,
      csvCell(escapeCsvFormula(String(row.status ?? ''))),
    ].join(',')
  })
  const csv = [header, ...lines].join('\r\n')
  // UTF-8 BOM + content
  const bom = '﻿'
  return new TextEncoder().encode(bom + csv)
}

/**
 * One CSV cell, quoted when it holds a comma, quote or line break.
 * @param {*} value A cell value.
 * @returns {string} The cell text.
 */
function csvCell(value) {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}
