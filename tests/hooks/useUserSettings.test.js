import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSettings } from '../../src/hooks/useUserSettings.js'
import { loadUserSettings, saveUserSettings } from '../../src/lib/userSettings.js'
import { deferred } from './deferred.js'

vi.mock('../../src/lib/userSettings.js', () => ({
  loadUserSettings: vi.fn(),
  saveUserSettings: vi.fn(),
}))

const defaults = {
  custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '',
  paid_cancellation_phrases: null, cancelled_keywords: null,
}
const saved = { ...defaults, default_message: 'Hello {student}' }
const next = { ...defaults, default_message: 'New message', cancelled_keywords: [] }

beforeEach(() => {
  loadUserSettings.mockReset().mockResolvedValue(saved)
  saveUserSettings.mockReset().mockResolvedValue(undefined)
})

describe('useUserSettings', () => {
  it('keeps defaults and skips loading and saving without an email', async () => {
    const { result } = renderHook(() => useUserSettings(null))

    expect(result.current.settings).toEqual(defaults)
    expect(result.current.isReady).toBe(false)
    await act(async () => { await result.current.saveSettings(next) })

    expect(loadUserSettings).not.toHaveBeenCalled()
    expect(saveUserSettings).not.toHaveBeenCalled()
    expect(result.current.settings).toEqual(defaults)
  })

  it('becomes ready only after settings have loaded', async () => {
    const load = deferred()
    loadUserSettings.mockReturnValueOnce(load.promise)
    const { result } = renderHook(() => useUserSettings('alice@example.com'))

    expect(loadUserSettings).toHaveBeenCalledWith('alice@example.com')
    expect(result.current.isReady).toBe(false)
    expect(result.current.settings).toEqual(defaults)
    await act(async () => { load.resolve(saved) })

    expect(result.current.isReady).toBe(true)
    expect(result.current.settings).toEqual(saved)
  })

  it('loads when an email becomes available and reloads for another user', async () => {
    const { result, rerender } = renderHook(email => useUserSettings(email), {
      initialProps: null,
    })
    await act(async () => { rerender('alice@example.com') })
    expect(result.current.settings).toEqual(saved)
    expect(result.current.isReady).toBe(true)

    const load = deferred()
    loadUserSettings.mockReturnValueOnce(load.promise)
    rerender('bob@example.com')
    expect(result.current.isReady).toBe(false)
    expect(loadUserSettings).toHaveBeenLastCalledWith('bob@example.com')
    await act(async () => { load.resolve(next) })
    expect(result.current.settings).toEqual(next)
    expect(result.current.isReady).toBe(true)

    await act(async () => { await result.current.saveSettings(saved) })
    expect(saveUserSettings).toHaveBeenCalledWith('bob@example.com', saved)
  })

  it('ignores a previous user’s load when it finishes after the current user’s load', async () => {
    const alice = deferred()
    const bob = deferred()
    loadUserSettings.mockReturnValueOnce(alice.promise).mockReturnValueOnce(bob.promise)
    const { result, rerender } = renderHook(email => useUserSettings(email), {
      initialProps: 'alice@example.com',
    })
    rerender('bob@example.com')

    await act(async () => { bob.resolve(next) })
    expect(result.current.settings).toEqual(next)
    expect(result.current.isReady).toBe(true)
    await act(async () => { alice.resolve(saved) })
    expect(result.current.settings).toEqual(next)
    expect(result.current.isReady).toBe(true)
  })

  it('does not publish a pending load after sign-out', async () => {
    const load = deferred()
    loadUserSettings.mockReturnValueOnce(load.promise)
    const { result, rerender } = renderHook(email => useUserSettings(email), {
      initialProps: 'alice@example.com',
    })
    rerender(null)
    await act(async () => { load.resolve(saved) })
    expect(result.current.isReady).toBe(false)
    expect(result.current.settings).toEqual(defaults)
  })

  it('does not publish a previous user’s pending save after switching users', async () => {
    const { result, rerender } = renderHook(email => useUserSettings(email), {
      initialProps: 'alice@example.com',
    })
    await act(async () => {})
    const save = deferred()
    saveUserSettings.mockReturnValueOnce(save.promise)
    let saving
    act(() => { saving = result.current.saveSettings(next) })
    loadUserSettings.mockResolvedValueOnce(defaults)
    await act(async () => { rerender('bob@example.com') })
    expect(result.current.settings).toEqual(defaults)
    await act(async () => {
      save.resolve()
      await saving
    })
    expect(result.current.settings).toEqual(defaults)
  })

  it('updates settings only after persistence succeeds', async () => {
    const { result } = renderHook(() => useUserSettings('alice@example.com'))
    await act(async () => {})
    const save = deferred()
    saveUserSettings.mockReturnValueOnce(save.promise)

    let saving
    act(() => { saving = result.current.saveSettings(next) })
    expect(saveUserSettings).toHaveBeenCalledWith('alice@example.com', next)
    expect(result.current.settings).toEqual(saved)
    await act(async () => {
      save.resolve()
      await saving
    })
    expect(result.current.settings).toEqual(next)
  })

  it('preserves persisted settings on a failed save and allows a retry', async () => {
    const { result } = renderHook(() => useUserSettings('alice@example.com'))
    await act(async () => {})
    const failure = new DOMException('quota exceeded', 'QuotaExceededError')
    saveUserSettings.mockRejectedValueOnce(failure)

    await act(async () => {
      await expect(result.current.saveSettings(next)).rejects.toBe(failure)
    })
    expect(result.current.settings).toEqual(saved)
    expect(result.current.isReady).toBe(true)

    await act(async () => { await result.current.saveSettings(next) })
    expect(result.current.settings).toEqual(next)
  })
})
