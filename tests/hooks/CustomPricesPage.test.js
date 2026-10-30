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
  const profileFor = name => within(card(name)).getByLabelText('💳 Payment profile')
  const optionValues = select => [...select.options].map(o => o.value)

  // Value: protects=the teacher picks from exactly the Make Router's two routes, defaulting to standard; fails_when=the field goes back to free text or a typed profile leaks into other cards' choices; why_new=bug report, extended was never offered and typos spread as suggestions; seam=none
  it('offers only the two Make routes and saves the chosen one', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(createElement(CustomPricesPage, { settings, onSave }))
    const select = profileFor('Dana Levy')
    expect(optionValues(select)).toEqual(['standard', 'extended'])
    expect(select.value).toBe('standard')

    fireEvent.change(select, { target: { value: 'extended' } })
    expect(optionValues(profileFor(PLAIN))).toEqual(['standard', 'extended'])

    const next = await save(onSave)
    expect(next.customer_details['Dana Levy'].payment_profile).toBe('extended')
  })

  // Value: protects=saved profiles map onto the Router's case-insensitive match, and an unknown one is shown as falling back to standard instead of vanishing; fails_when='Extended' shows as a separate or unselected option, or a legacy value is silently replaced; why_new=the select must round-trip values saved by the old free-text field; seam=none
  it('selects a differently cased route and flags an unrecognized saved value', () => {
    render(createElement(CustomPricesPage, {
      settings: {
        customer_details: {
          'Dana Levy': { phone: '050-2222222', payment_profile: 'Extended' },
          'Noa Cohen': { phone: '050-3333333', payment_profile: 'vip' },
        },
      },
      onSave: vi.fn(),
    }))
    expect(profileFor('Dana Levy').value).toBe('extended')
    expect(optionValues(profileFor('Dana Levy'))).toEqual(['standard', 'extended'])

    const legacy = profileFor('Noa Cohen')
    expect(legacy.value).toBe('vip')
    expect(legacy.selectedOptions[0].textContent).toBe('vip (not recognized: gets Standard)')
  })
})
