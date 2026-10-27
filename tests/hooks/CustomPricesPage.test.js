import { createElement } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomPricesPage } from '../../src/components/CustomPricesPage.jsx'

const PRICED = 'ענבר 11.5 (אמא עינת)'
const PLAIN = 'ענבר'
const settings = {
  custom_prices: { [PRICED]: { regular: { '60': 230, '45': 200, '30': 180 } } },
  customer_details: { [PLAIN]: { phone: '050-1111111' }, 'Dana Levy': { phone: '050-2222222' } },
}
const card = name => screen.getByText(name, { selector: 'span' }).closest('div').parentElement

async function save(onSave) {
  await act(async () => { fireEvent.click(screen.getByText('Save all')) })
  return onSave.mock.calls.at(-1)[0]
}

describe('CustomPricesPage spellings of one student', () => {
  // Value: protects=a price typed on a spelling without its own price is saved to the priced spelling, so the calculation never sees two conflicting prices for one student; fails_when=the alias card writes its own entry, which blocks sending with a price conflict; why_new=the redirect is new; seam=none
  it('saves a price typed on the plain spelling to the priced one', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(createElement(CustomPricesPage, { settings, onSave }))
    const plain = card(PLAIN)
    expect(within(plain).getByText(/Same student as “ענבר 11\.5 \(אמא עינת\)”/)).toBeTruthy()
    const [regular60] = within(plain).getAllByLabelText('60 min')
    expect(regular60.value).toBe('230')
    fireEvent.change(regular60, { target: { value: '250' } })

    const next = await save(onSave)
    expect(next.custom_prices).toEqual({ [PRICED]: { regular: { '60': 250, '45': 200, '30': 180 } } })
    expect(next.customer_details[PLAIN]).toEqual({ phone: '050-1111111' })
  })
})

describe('CustomPricesPage remove and undo', () => {
  // Value: protects=Remove can be undone until Save all, restoring everything the card held, and a confirmed remove deletes it; fails_when=Undo restores only part of the card (phone lost) or Remove deletes immediately; why_new=undo is new; seam=none
  it('restores a removed card until Save all, and deletes it after', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(createElement(CustomPricesPage, { settings, onSave }))
    fireEvent.click(within(card('Dana Levy')).getByText('Remove'))
    expect(screen.getByRole('status').textContent).toContain('Dana Levy will be removed when you press Save all.')
    fireEvent.click(screen.getByText('Undo'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(within(card('Dana Levy')).getByDisplayValue('050-2222222')).toBeTruthy()
    expect((await save(onSave)).customer_details['Dana Levy']).toEqual({ phone: '050-2222222' })

    fireEvent.click(within(card('Dana Levy')).getByText('Remove'))
    const next = await save(onSave)
    expect(next.customer_details).not.toHaveProperty('Dana Levy')
    expect(screen.queryByText('Undo')).toBeNull()
  })
})
