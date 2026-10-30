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
  it('keeps Save all available to persist removal of the last student', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(createElement(CustomPricesPage, {
      settings: {
        custom_prices: settings.custom_prices,
        customer_details: { [PRICED]: { phone: '050-1111111', full_name: 'Parent Name' } },
      },
      onSave,
    }))

    fireEvent.click(within(card(PRICED)).getByText('Remove'))
    expect(screen.getByRole('status').textContent).toContain('will be removed when you press Save all.')
    expect(screen.queryByText(/No saved students yet/)).toBeNull()
    expect(onSave).not.toHaveBeenCalled()

    const next = await save(onSave)
    expect(next.custom_prices).toEqual({})
    expect(next.customer_details).toEqual({})
    expect(screen.queryByText('Undo')).toBeNull()
    expect(screen.getByText(/No saved students yet/)).toBeTruthy()
  })

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

describe('CustomPricesPage payment profile', () => {
  // Value: protects=the teacher can pick "extended" (every Grow method) without knowing the word; fails_when=suggestions only list profiles already saved, so extended never appears; why_new=bug report, only "standard" was offered; seam=none
  it('suggests both Make routes before any student uses them', () => {
    const { container } = render(createElement(CustomPricesPage, { settings, onSave: vi.fn() }))
    const options = [...container.querySelectorAll('#payment-profiles option')].map(o => o.value)
    expect(options).toEqual(['standard', 'extended'])
  })

  // Value: protects=a profile name already in use (custom or built-in) stays offered once, after the two routes; fails_when=the list becomes a hard-coded pair of routes (custom profiles vanish) or loses its dedupe (a saved "extended" shows twice); why_new=existing test has no saved profiles, so neither merge path runs; seam=none
  it('keeps saved custom profiles and lists each name once', () => {
    const { container } = render(createElement(CustomPricesPage, {
      settings: {
        customer_details: {
          'Dana Levy': { phone: '050-2222222', payment_profile: 'extended' },
          'Noa Cohen': { phone: '050-3333333', payment_profile: ' vip ' },
        },
      },
      onSave: vi.fn(),
    }))
    const options = [...container.querySelectorAll('#payment-profiles option')].map(o => o.value)
    expect(options).toEqual(['standard', 'extended', 'vip'])
  })
})
