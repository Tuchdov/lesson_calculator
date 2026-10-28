import { createElement } from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CalculatorPage } from '../../src/components/CalculatorPage.jsx'
import { useBilling } from '../../src/hooks/useBilling.js'
import { useCalendarData } from '../../src/hooks/useCalendarData.js'
vi.mock('../../src/hooks/useBilling.js', () => ({ useBilling: vi.fn() }))
vi.mock('../../src/hooks/useCalendarData.js', () => ({ useCalendarData: vi.fn() }))
const student = {
  id: 'student123', name: 'Alice Smith', aliases: ['Alice Smith'], revision: 2,
  currentAgorot: 30000, currentVersion: 1, paidAgorot: 10000, priorAgorot: 20000, remainingAgorot: 50000,
  invoices: [{ id: 'invoice123', month: '2026-08', chargeAgorot: 30000, version: 1 }],
  pending: [], payments: [], legacy: [], hold: null,
  request: { id: 'request123', requestId: 'client123', state: 'ready', reusable: true, link: 'https://pay.example/link' },
}
const config = { prices: { regular: { 60: 300, 45: 150, 30: 100 }, non_regular: { 60: 300, 45: 150, 30: 100 } } }
const props = { userEmail: 'teacher@example.com', getAccessToken: async () => 'token', config, customerDetails: { 'Alice Smith': { full_name: 'Alice Smith', phone: '0501234567' } } }
function fixture(overrides = {}) {
  return { data: { month: '2026-08', mode: 'live', recovery: false, students: [student], ...overrides }, loading: false, error: null, refresh: vi.fn(), action: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  useCalendarData.mockReturnValue({ rows: [{ student: 'Alice Smith', student_type: 'regular', lessons_60: 1, lessons_45: 0, lessons_30: 0 }], summary: { month: '2026-08' }, calculate: vi.fn() })
  useBilling.mockReturnValue(fixture())
})
describe('calculator billing', () => {
  it('sends the full remaining balance including prior debt in WhatsApp', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(createElement(CalculatorPage, props))
    expect(screen.getByText('Saved outstanding: ₪500.00')).toBeTruthy()
    expect(screen.getByText('₪200.00')).toBeTruthy()
    fireEvent.click(screen.getByText('📱 שלח'))
    const url = new URL(open.mock.calls[0][0])
    expect(url.searchParams.get('text')).toContain('500')
    expect(url.searchParams.get('text')).toContain('https://pay.example/link')
  })
  it('shows students with previous debt even if no calendar lessons were found', () => {
    useCalendarData.mockReturnValue({ rows: [], summary: { month: '2026-08' }, calculate: vi.fn() })
    useBilling.mockReturnValue(fixture({ students: [{ ...student, currentVersion: null, currentAgorot: 0, invoices: [{ id: 'earlier', month: '2026-07', chargeAgorot: 20000 }], remainingAgorot: 20000, request: null }] }))
    render(createElement(CalculatorPage, props))
    expect(screen.getByText('Alice Smith')).toBeTruthy()
    expect(screen.getByText('Saved outstanding: ₪200.00')).toBeTruthy()
    expect(screen.getByText('🔗 הכן קישור').disabled).toBe(false)
  })
  it('blocks stale payment links while preserving CSV export of unsaved lesson estimates', async () => {
    const createObjectURL = vi.fn(() => 'blob:estimate')
    const OriginalURL = URL
    vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn() })
    vi.stubGlobal('Blob', NodeBlob)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(createElement(CalculatorPage, { ...props, amountOverrides: { '2026-08:Alice Smith': 400 } }))
    expect(screen.getByText('📱 שלח').disabled).toBe(true)
    expect(screen.getByText('Download CSV').disabled).toBe(false)
    fireEvent.click(screen.getByText('Download CSV'))
    const csv = await createObjectURL.mock.calls[0][0].text()
    expect(csv).toContain('400')
    expect(csv).not.toContain('prior_balance')
    expect(csv).not.toContain('payment_status')
    expect(screen.getByText(/Charge differs from saved invoice/)).toBeTruthy()
  })
  it('does not present an unavailable payment status as unpaid', () => {
    useBilling.mockReturnValue({ data: null, error: 'Database unavailable', loading: false, refresh: vi.fn() })
    render(createElement(CalculatorPage, props))
    expect(screen.getByText('Status unavailable')).toBeTruthy()
    expect(screen.getByText('Prepare all links').disabled).toBe(true)
    expect(screen.queryByText('Unpaid')).toBeNull()
    expect(screen.getByText('Download CSV').disabled).toBe(false)
  })
  it('blocks collection while a payment report awaits confirmation', () => {
    useBilling.mockReturnValue(fixture({ students: [{ ...student, hold: 'Check Grow', pending: [{ id: 'event123', transactionId: 'txn123', statusCode: '2', amountAgorot: 50000 }] }] }))
    render(createElement(CalculatorPage, props))
    expect(screen.getByText('Payment reported — verify')).toBeTruthy()
    expect(screen.getByText('📱 שלח').disabled).toBe(true)
  })
})
