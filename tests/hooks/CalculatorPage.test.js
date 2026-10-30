import { createElement } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CalculatorPage } from '../../src/components/CalculatorPage.jsx'
import { requestPaymentLink } from '../../src/lib/paymentLinkClient.js'
import { calculatePayments, DEFAULT_LESSON_KEYWORDS } from '../../src/lib/calendarPayments.js'
import { linkInputs } from '../../src/lib/payments.js'

vi.mock('../../src/lib/paymentLinkClient.js', () => ({ requestPaymentLink: vi.fn() }))

const month = '2026-03'
const lesson = (title, day, minutes = 60) => {
  const start = new Date(Date.UTC(2026, 2, day, 10))
  return {
    id: `${title}-${day}`,
    summary: `${title} - פיתוח קול`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + minutes * 60000).toISOString() },
  }
}
const customPrices = { 'Ella Oz (a)': { '60': 230, '45': 200, '30': 180 } }
const customerDetails = {
  'Dana Levy': { phone: '050-1234567' },
  'Noa Cohen': { phone: '050-2345678' },
  'Ella Oz (a)': { phone: '050-1111111' },
  'Ella Oz (b)': { phone: '050-2222222' },
  Gil: { phone: '050-3456789' },
  'Tal Ron': { phone: '050-4567890' },
  'Omer Paz': { phone: '050-5678901', full_name: 'Rina Paz' },
  'Lior Ben': { phone: '050-6789012' },
}
const config = {
  prices: {
    regular: { '60': 200, '45': 150, '30': 100 },
    non_regular: { '60': 250, '45': 180, '30': 120 },
  },
}
const events = [
  lesson('Dana Levy', 2),
  lesson('Noa Cohen', 3), lesson('Noa Cohen', 10, 75),
  lesson('Ella Oz', 4),
  lesson('Maya Bar', 5),
  lesson('Gil', 6),
  lesson('Tal Ron', 9),
  lesson('Omer Paz', 11), lesson('Omer Paz', 12, 75),
  lesson('Lior Ben', 13),
]
const calcConfig = { ...config, custom_prices: customPrices, customer_details: customerDetails }
const { rows, summary } = calculatePayments(events, calcConfig, month)

function pageProps(overrides = {}) {
  return {
    getAccessToken: vi.fn(),
    config,
    calendar: { rows, summary, loading: false, error: null, calculate: vi.fn(), calculatedWith: config },
    month, onMonthChange: vi.fn(),
    customPrices, customerDetails,
    amountOverrides: { [`${month}:Omer Paz`]: 321 },
    paymentLinks: {
      [`${month}:Tal Ron`]: {
        link: 'https://pay.example/tal', amount: 250,
        inputs: linkInputs({ payerName: 'Tal Ron', phone: '050-4567890', lessonStudent: 'Tal Ron' }),
      },
    },
    onPaymentLinkChange: vi.fn(),
    reviewResolutions: {},
    preparing: false, onPreparingChange: vi.fn(),
    prepareStatus: { [`${month}:Lior Ben`]: 'loading', '2026-09:Dana Levy': 'loading' }, onPrepareStatusChange: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  requestPaymentLink.mockReset().mockImplementation(async (_token, { studentName }) => `https://pay.example/${encodeURIComponent(studentName)}`)
})

describe('CalculatorPage Prepare all links', () => {
  // Value: protects=bulk minting only bills rows whose amount and payer are final (skips unresolved review, name conflicts, missing phone, single-word payer, an already-usable link, a row already minting) and charges a manual override, not the computed amount; fails_when=any eligibility filter in handlePrepareAll is dropped or the override is ignored; why_new=Prepare-all skip rules had no test; seam=none
  it('mints links only for rows that are ready to bill', async () => {
    expect(rows.find(r => r.student === 'Ella Oz (a)').name_conflicts).toEqual(['phone'])
    const props = pageProps()
    render(createElement(CalculatorPage, props))
    expect(screen.queryByRole('status')).toBeNull()

    await act(async () => { fireEvent.click(screen.getByText('Prepare all links')) })

    const minted = requestPaymentLink.mock.calls.map(([, req]) => [req.lessonStudent, req.studentName, req.amount])
    expect(minted.sort()).toEqual([
      ['Dana Levy', 'Dana Levy', 250],
      ['Omer Paz', 'Rina Paz', 321],
    ])
    expect(requestPaymentLink.mock.calls.every(([, req]) => req.month === month)).toBe(true)
    expect(props.onPaymentLinkChange).toHaveBeenCalledWith(
      month, 'Omer Paz', 'https://pay.example/Rina%20Paz', 321,
      linkInputs({ payerName: 'Rina Paz', phone: '050-5678901', lessonStudent: 'Omer Paz' }),
    )
    expect(props.onPreparingChange.mock.calls).toEqual([[true], [false]])
  })
})

describe('CalculatorPage stale table', () => {
  // Value: protects=a Settings change since Calculate pauses Prepare all with a reason, while saving a list that equals its default does not; fails_when=staleness compares raw values (null vs the default array) or Prepare all ignores it; why_new=stale gating had no component test; seam=none
  it('pauses Prepare all only when an applied setting really changed', async () => {
    const fresh = pageProps({ calendar: { rows, summary, loading: false, error: null, calculate: vi.fn(), calculatedWith: config }, config: { ...config, lesson_keywords: [...DEFAULT_LESSON_KEYWORDS] } })
    const { rerender } = render(createElement(CalculatorPage, fresh))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Prepare all links').disabled).toBe(false)

    const stale = pageProps({ config: { ...config, lesson_keywords: ['שיעור'] } })
    rerender(createElement(CalculatorPage, stale))
    expect(screen.getByRole('status').textContent).toMatch(/^Settings changed since this calculation/)
    const button = screen.getByText('Prepare all links')
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Press Calculate again first')
    await act(async () => { fireEvent.click(button) })
    expect(requestPaymentLink).not.toHaveBeenCalled()
    expect(stale.onPreparingChange).not.toHaveBeenCalled()
  })
})

describe('CalculatorPage failed mint', () => {
  // Value: protects=one failed link shows its error on that row for this month only, saves nothing for it, and the rest of the run still completes; fails_when=the error is keyed without the month, a failure aborts the batch, or a failed mint is stored; why_new=the Prepare-all error path had no test; seam=none
  it('records the error for the month and keeps going', async () => {
    requestPaymentLink.mockImplementation(async (_token, { studentName }) => {
      if (studentName === 'Dana Levy') throw new Error('Grow is down')
      return `https://pay.example/${encodeURIComponent(studentName)}`
    })
    let status = {}
    const props = pageProps({ onPrepareStatusChange: vi.fn(update => { status = update(status) }) })
    render(createElement(CalculatorPage, props))
    await act(async () => { fireEvent.click(screen.getByText('Prepare all links')) })

    expect(status[`${month}:Dana Levy`]).toEqual({ error: 'Grow is down' })
    expect(status[`${month}:Omer Paz`]).toBeNull()
    expect(props.onPaymentLinkChange.mock.calls.map(c => c[1])).toEqual(['Omer Paz'])
    expect(props.onPreparingChange.mock.calls).toEqual([[true], [false]])
  })
})
