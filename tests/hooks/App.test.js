import { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from './deferred.js'
import { loadTierOverrides } from '../../src/lib/payments.js'
import App from '../../src/App.jsx'

const auth = vi.hoisted(() => ({ userEmail: 'a@example.com' }))

vi.mock('../../src/hooks/useAuth.js', () => ({
  useAuth: () => ({ accessToken: 'token', userEmail: auth.userEmail, signIn() {}, signOut() {}, error: null, getValidAccessToken: async () => 'token' }),
}))
vi.mock('../../src/hooks/useUserSettings.js', () => ({
  useUserSettings: () => ({ settings: { custom_prices: {}, customer_details: {}, default_prices: {} }, saveSettings: vi.fn(), isReady: true }),
}))
vi.mock('../../src/hooks/useCalendarData.js', () => ({
  useCalendarData: () => ({ rows: null, summary: null, loading: false, error: null, calculate() {}, reset() {}, calculatedWith: null }),
}))
vi.mock('../../src/lib/payments.js', async importOriginal => ({
  ...(await importOriginal()),
  loadAmountOverrides: vi.fn(async () => ({})),
  loadLessonOverrides: vi.fn(async () => ({})),
  loadPaymentLinks: vi.fn(async () => ({})),
  loadReviewResolutions: vi.fn(async () => ({})),
  loadTierOverrides: vi.fn(),
}))
// Shows the tier overrides App hands the calculator.
vi.mock('../../src/components/CalculatorPage.jsx', () => ({
  CalculatorPage: ({ tierOverrides }) => createElement('output', { 'data-testid': 'tiers' }, JSON.stringify(tierOverrides)),
}))

describe('App per-account stores', () => {
  beforeEach(() => {
    auth.userEmail = 'a@example.com'
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
