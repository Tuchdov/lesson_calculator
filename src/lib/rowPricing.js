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
