import { createElement } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditableTable } from '../../src/components/EditableTable.jsx'
import { requestPaymentLink } from '../../src/lib/paymentLinkClient.js'
import { linkInputs } from '../../src/lib/payments.js'

vi.mock('../../src/lib/paymentLinkClient.js', () => ({ requestPaymentLink: vi.fn() }))

const config = {
  prices: {
    regular: { '60': 200, '45': 150, '30': 100 },
    non_regular: { '60': 250, '45': 180, '30': 120 },
  },
}
const month = '2026-03'
const reviewItem = {
  id: 'e1', summary: 'Dana Levy - פיתוח קול', start: '2026-03-10T10:00:00Z', minutes: 75, makeup: false, auto: null,
}
const cleanRow = {
  student: 'Dana Levy', aliases: [], name_conflicts: [], student_type: 'regular',
  lessons_60: 1, lessons_45: 0, lessons_30: 0, amount_due: 200, review_items: [],
}
const customerDetails = { 'Dana Levy': { phone: '050-1234567' } }
const PREPARE = '🔗 הכן קישור'

function baseProps(overrides = {}) {
  return {
    rows: [cleanRow], config, month, customerDetails,
    getAccessToken: vi.fn(), onRowStatusChange: vi.fn(), onPaymentLinkChange: vi.fn(),
    prepareStatus: {}, paymentLinks: {}, reviewResolutions: {}, sendBlocked: false,
    ...overrides,
  }
}

// Clicks every button in the table (send, regenerate, chips) so no path that
// could mint a link is left untried.
async function clickEverything() {
  for (const button of screen.queryAllByRole('button')) {
    await act(async () => { fireEvent.click(button) })
  }
}

beforeEach(() => {
  requestPaymentLink.mockReset().mockResolvedValue('https://pay.example/1')
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

describe('EditableTable send guards', () => {
  // Value: protects=no payment link is minted for a row whose amount is not final (unresolved review item), that is probably two students (name_conflicts), or whose table is stale (sendBlocked), and the row mints normally once the block clears; fails_when=any guard in handleSendClick or the WhatsApp-cell branches is dropped, letting a wrong amount or wrong payer reach Grow; why_new=send blocking had no component test; seam=none
  it.each([
    ['an unresolved review item',
      { rows: [{ ...cleanRow, review_items: [reviewItem] }] },
      { rows: [{ ...cleanRow, review_items: [reviewItem] }], reviewResolutions: { [`${month}:Dana Levy:e1`]: { mode: 'free' } } }],
    ['saved spellings that conflict',
      { rows: [{ ...cleanRow, aliases: ['Dana Levy (2)'], name_conflicts: ['phone'] }] },
      { rows: [cleanRow] }],
    ['a stale calculation', { sendBlocked: true }, { sendBlocked: false }],
  ])('never requests a link for a row with %s', async (_label, blocked, unblocked) => {
    const { rerender } = render(createElement(EditableTable, baseProps(blocked)))
    await clickEverything()
    expect(requestPaymentLink).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()

    const props = baseProps(unblocked)
    rerender(createElement(EditableTable, props))
    await act(async () => { fireEvent.click(screen.getByText(PREPARE)) })
    expect(requestPaymentLink).toHaveBeenCalledTimes(1)
    expect(requestPaymentLink).toHaveBeenCalledWith(props.getAccessToken, expect.objectContaining({
      studentName: 'Dana Levy', phone: '050-1234567', amount: 200, month,
    }))
  })
})

describe('EditableTable with a ready link', () => {
  const omer = { ...cleanRow, student: 'Omer Paz' }
  const details = { 'Omer Paz': { phone: '050-5678901', full_name: 'Rina Paz' } }
  const readyLinks = {
    [`${month}:Omer Paz`]: {
      link: 'https://pay.example/omer', amount: 200,
      inputs: linkInputs({ payerName: 'Rina Paz', phone: '050-5678901', lessonStudent: 'Omer Paz' }),
    },
  }
  const props = overrides => baseProps({
    rows: [omer], customerDetails: details, paymentLinks: readyLinks,
    defaultMessage: 'שלום {payer}, {student}: ₪{amount} {link}', onCustomPriceChange: vi.fn(), ...overrides,
  })

  // Value: protects=a stale table keeps a ready link's WhatsApp and ↻ buttons and the inline price edit locked, says why, and once fresh sends a message greeting the payer and naming the student; fails_when=sendBlocked only guards the prepare path, the edit lock is dropped, or {payer}/{student} swap; why_new=the ready-link branch and edit lock had no test; seam=none
  it('pauses send, regenerate and edits while stale, then sends to the payer', async () => {
    const blocked = props({ sendBlocked: true })
    const { rerender } = render(createElement(EditableTable, blocked))
    const send = screen.getByText('📱 שלח')
    expect(send.disabled).toBe(true)
    expect(send.title).toBe('Press Calculate again first')
    expect(screen.getByText('↻').disabled).toBe(true)
    // The rate and the amount both read ₪200; neither opens an editor.
    const editable = screen.getAllByText('₪200')
    expect(editable).toHaveLength(2)
    for (const cell of editable) {
      expect(cell.title).toBe('Press Calculate again first')
      fireEvent.doubleClick(cell)
    }
    expect(screen.queryByRole('textbox')).toBeNull()
    await clickEverything()
    expect(window.open).not.toHaveBeenCalled()
    expect(requestPaymentLink).not.toHaveBeenCalled()
    expect(blocked.onCustomPriceChange).not.toHaveBeenCalled()

    rerender(createElement(EditableTable, props()))
    await act(async () => { fireEvent.click(screen.getByText('📱 שלח')) })
    expect(requestPaymentLink).not.toHaveBeenCalled()
    const url = new URL(window.open.mock.calls[0][0])
    expect(url.searchParams.get('text')).toBe('שלום Rina Paz, Omer Paz: ₪200 https://pay.example/omer')
  })
})
