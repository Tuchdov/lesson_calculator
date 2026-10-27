import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBilling } from '../../src/hooks/useBilling.js'
import { billingRequest } from '../../src/lib/billingClient.js'
import { loadLegacyPaymentLinks, loadPaymentLinks } from '../../src/lib/payments.js'

vi.mock('../../src/lib/billingClient.js', () => ({ billingRequest: vi.fn() }))
vi.mock('../../src/lib/payments.js', () => ({ loadLegacyPaymentLinks: vi.fn(), loadPaymentLinks: vi.fn() }))
const token = async () => 'test-token'
const snapshot = month => ({ month, students: [], mode: 'shadow' })
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

beforeEach(() => { vi.clearAllMocks(); loadLegacyPaymentLinks.mockResolvedValue({}); loadPaymentLinks.mockResolvedValue({}) })

describe('useBilling', () => {
  it('ignores an older month response after switching months', async () => {
    const old = deferred()
    billingRequest.mockImplementation((_token, path) => path.includes('2026-08') ? old.promise : Promise.resolve(snapshot('2026-09')))
    const { result, rerender } = renderHook(({ month }) => useBilling(token, 'teacher@example.com', month), { initialProps: { month: '2026-08' } })
    await waitFor(() => expect(billingRequest).toHaveBeenCalled())
    rerender({ month: '2026-09' })
    await waitFor(() => expect(result.current.data?.month).toBe('2026-09'))
    await act(async () => { old.resolve(snapshot('2026-08')) })
    expect(result.current.data.month).toBe('2026-09')
  })

  it('keeps the prior user snapshot hidden when identity changes', async () => {
    billingRequest.mockResolvedValue(snapshot('2026-08'))
    const { result, rerender } = renderHook(({ owner }) => useBilling(token, owner, '2026-08'), { initialProps: { owner: 'teacher@example.com' } })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    billingRequest.mockReturnValue(new Promise(() => {}))
    rerender({ owner: 'another@example.com' })
    expect(result.current.data).toBeNull()
  })

  it('never imports or prunes a previous account after its local read completes late', async () => {
    const old = deferred()
    loadLegacyPaymentLinks.mockImplementation(owner => owner === 'old@example.com' ? old.promise : Promise.resolve({}))
    billingRequest.mockResolvedValue(snapshot('2026-08'))
    const { result, rerender } = renderHook(({ owner }) => useBilling(token, owner, '2026-08'), { initialProps: { owner: 'old@example.com' } })
    await waitFor(() => expect(loadLegacyPaymentLinks).toHaveBeenCalledWith('old@example.com'))
    rerender({ owner: 'teacher@example.com' })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    await act(async () => { old.resolve({ '2026-07:Old Private Student': { link: 'https://pay.example/private', amount: 100 } }) })
    expect(billingRequest.mock.calls.some(call => call[2]?.entries?.some(entry => entry.student === 'Old Private Student'))).toBe(false)
    expect(loadPaymentLinks.mock.calls.some(call => call[0] === 'old@example.com')).toBe(false)
  })

  it('clears stale status on a failed refresh and refreshes when the window receives focus', async () => {
    billingRequest.mockResolvedValue(snapshot('2026-08'))
    const { result } = renderHook(() => useBilling(token, 'teacher@example.com', '2026-08'))
    await waitFor(() => expect(result.current.data).toBeTruthy())
    billingRequest.mockRejectedValueOnce(new Error('Billing is unavailable'))
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current.error).toBe('Billing is unavailable'))
    expect(result.current.data).toBeNull()
  })

  it('imports historical links before reading balances, without deleting browser data', async () => {
    loadLegacyPaymentLinks.mockResolvedValue({ '2026-07:Alice Smith': { link: 'https://pay.example/old', amount: 487.5 } })
    billingRequest.mockResolvedValue(snapshot('2026-08'))
    const { result } = renderHook(() => useBilling(token, 'teacher@example.com', '2026-08'))
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(billingRequest.mock.calls[0][2]).toEqual({ action: 'importLegacy', month: '2026-08', entries: [{ month: '2026-07', student: 'Alice Smith', link: 'https://pay.example/old', amountAgorot: 48750 }] })
    expect(billingRequest.mock.calls[1][1]).toBe('/api/billing?month=2026-08')
  })
})
