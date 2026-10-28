import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { BillingActions } from '../../src/components/BillingActions.jsx'

it.each([
  ['recordManual', 'Record cash / bank payment', 50000],
  ['openingBalance', 'Record reviewed opening balance', 0],
  ['adjustInvoice', 'Adjust saved charge', 30000],
  ['closeRequest', 'Record closure checked in Grow', undefined],
  ['reversePayment', 'Record verified refund / correction', 10000],
])('%s submits the revision reviewed when the form opened', async (action, button, amountAgorot) => {
  const student = {
    id: 'student123', revision: 2, remainingAgorot: 50000, hold: null, legacy: [], pending: [],
    invoices: [{ id: 'invoice123', month: '2026-08', chargeAgorot: 30000 }],
    payments: [{ id: 'payment123', source: 'bank', netAgorot: 10000, creditAgorot: 0 }],
    request: { id: 'request123', state: 'ready', reusable: true },
  }
  const billing = { data: { month: '2026-08' }, action: vi.fn().mockResolvedValue({}), refresh: vi.fn() }
  const { rerender } = render(createElement(BillingActions, { student, billing, previewCharge: 30000 }))
  fireEvent.click(screen.getByText(button))
  fireEvent.change(screen.getByLabelText('Evidence / reason'), { target: { value: 'Verified against bank records' } })

  // Returning from the bank/Grow tab refreshes the ledger while the form stays open.
  rerender(createElement(BillingActions, { student: { ...student, revision: 3, remainingAgorot: 10000 }, billing, previewCharge: 10000 }))
  fireEvent.click(screen.getByText('Save checked record'))
  await waitFor(() => expect(billing.action).toHaveBeenCalledOnce())
  expect(billing.action).toHaveBeenCalledWith(action, expect.objectContaining({ studentId: student.id, revision: 2, evidence: 'Verified against bank records' }))
  if (amountAgorot !== undefined) expect(billing.action.mock.calls[0][1][action === 'adjustInvoice' ? 'chargeAgorot' : 'amountAgorot']).toBe(amountAgorot)

  await waitFor(() => expect(screen.queryByText('Save checked record')).toBeNull())
  fireEvent.click(screen.getByText(button))
  fireEvent.change(screen.getByLabelText('Evidence / reason'), { target: { value: 'Reviewed refreshed bank records' } })
  fireEvent.click(screen.getByText('Save checked record'))
  await waitFor(() => expect(billing.action).toHaveBeenCalledTimes(2))
  expect(billing.action.mock.calls[1][1].revision).toBe(3)
})
