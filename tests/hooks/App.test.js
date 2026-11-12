import { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from './deferred.js'
import { loadTierOverrides } from '../../src/lib/payments.js'
import { loadCalculation, saveCalculation } from '../../src/lib/calculationStore.js'
import App from '../../src/App.jsx'

const auth = vi.hoisted(() => ({ userEmail: 'a@example.com' }))
const calc = vi.hoisted(() => ({ rows: null, summary: null, calculatedWith: null, restore: null }))

vi.mock('../../src/hooks/useAuth.js', () => ({
  useAuth: () => ({ accessToken: 'token', userEmail: auth.userEmail, signIn() {}, signOut() {}, error: null, getValidAccessToken: async () => 'token' }),
}))
vi.mock('../../src/hooks/useUserSettings.js', () => ({
  useUserSettings: () => ({ settings: { custom_prices: {}, customer_details: {}, default_prices: {} }, saveSettings: vi.fn(), isReady: true }),
}))
vi.mock('../../src/hooks/useCalendarData.js', () => ({
  useCalendarData: () => ({ rows: calc.rows, summary: calc.summary, loading: false, error: null, calculate() {}, reset() {}, restore: calc.restore, calculatedWith: calc.calculatedWith }),
}))
vi.mock('../../src/lib/payments.js', async importOriginal => ({
  ...(await importOriginal()),
  loadAmountOverrides: vi.fn(async () => ({})),
  loadLessonOverrides: vi.fn(async () => ({})),
  loadPaymentLinks: vi.fn(async () => ({})),
  loadReviewResolutions: vi.fn(async () => ({})),
  loadTierOverrides: vi.fn(),
}))
// Shows the tier overrides and the month App hands the calculator.
vi.mock('../../src/components/CalculatorPage.jsx', () => ({
  CalculatorPage: ({ tierOverrides, month }) => createElement('div', null,
    createElement('output', { 'data-testid': 'tiers' }, JSON.stringify(tierOverrides)),
    createElement('output', { 'data-testid': 'month' }, month)),
}))

describe('App per-account stores', () => {
  beforeEach(() => {
    auth.userEmail = 'a@example.com'
    Object.assign(calc, { rows: null, summary: null, calculatedWith: null, restore: vi.fn(() => false) })
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ prices: {} }) })))
  })

  // Value: protects=a discount granted under one account never prices another account's invoices; fails_when=a slow load for the earlier account resolves after the switch and its overrides replace the current account's; why_new=account switch race; seam=payments.js loaders
  it('discards a load that finishes after the account changed', async () => {
    const first = deferred()
    const second = deferred()
    loadTierOverrides.mockImplementation(email => (email === 'a@example.com' ? first : second).promise)

    const { rerender } = render(createElement(App))
    const tiers = await screen.findByTestId('tiers')

    auth.userEmail = 'b@example.com'
    rerender(createElement(App))
    await act(async () => second.resolve({ '2026-03:Bob': 'regular' }))
    await act(async () => first.resolve({ '2026-03:Alice': 'regular' }))
    expect(JSON.parse(tiers.textContent)).toEqual({ '2026-03:Bob': 'regular' })
  })

  // Value: protects=the earlier account's overrides stop applying the moment the account changes, not when the new load finishes; fails_when=state is only replaced on load; why_new=account switch race; seam=payments.js loaders
  it("clears the earlier account's overrides while the new one loads", async () => {
    const second = deferred()
    loadTierOverrides.mockImplementation(async email => (email === 'a@example.com' ? { '2026-03:Alice': 'regular' } : second.promise))

    const { rerender } = render(createElement(App))
    const tiers = await screen.findByTestId('tiers')
    await vi.waitFor(() => expect(JSON.parse(tiers.textContent)).toEqual({ '2026-03:Alice': 'regular' }))

    auth.userEmail = 'b@example.com'
    rerender(createElement(App))
    expect(JSON.parse(tiers.textContent)).toEqual({})
  })
})

describe('App saved calculation', () => {
  const saved = {
    rows: [{ student: 'Alice', student_type: 'regular', lessons_60: 1, lessons_45: 0, lessons_30: 0, review_items: [] }],
    summary: { month: '2025-11', students: 1, total_amount_due: 200 },
    calculatedWith: null,
  }

  beforeEach(() => {
    auth.userEmail = 'a@example.com'
    Object.assign(calc, { rows: null, summary: null, calculatedWith: null, restore: vi.fn(() => true) })
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ prices: {} }) })))
    loadTierOverrides.mockResolvedValue({})
  })

  // Value: protects=reopening the site shows the account's last calculation and its month; fails_when=App never loads the saved calculation or leaves the month picker on today; why_new=calculations now survive closing the site; seam=localStorage via calculationStore
  it('restores the last calculation and its month on sign-in', async () => {
    await saveCalculation('a@example.com', saved)
    render(createElement(App))
    await vi.waitFor(() => expect(calc.restore).toHaveBeenCalledWith(saved))
    await vi.waitFor(() => expect(screen.getByTestId('month').textContent).toBe('2025-11'))
  })

  // Value: protects=a calculated table is saved for the account it belongs to, so it's there after a reload; fails_when=App doesn't persist rows, or saves them under another account; why_new=calculations now survive closing the site; seam=localStorage via calculationStore
  it('saves the calculated table for the signed-in account', async () => {
    Object.assign(calc, { rows: saved.rows, summary: saved.summary })
    render(createElement(App))
    await vi.waitFor(async () => expect(await loadCalculation('a@example.com')).toEqual(saved))
    expect(await loadCalculation('b@example.com')).toBeNull()
  })
})
