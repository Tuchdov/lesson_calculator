import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../src/hooks/useAuth.js'
import { deferred } from './deferred.js'

const NOW = new Date('2026-03-10T12:00:00Z').getTime()
let clients
let initTokenClient
let revoke

/**
 * Seed session storage with an authenticated user for a hook test.
 * @param {number} expiresAt Token expiry in milliseconds since the epoch.
 */
function storeSession(expiresAt = NOW + 3_600_000) {
  sessionStorage.setItem('gis_access_token', 'stored-token')
  sessionStorage.setItem('gis_expires_at', String(expiresAt))
  sessionStorage.setItem('gis_user_email', 'alice@example.com')
}

/**
 * Deliver a simulated Google token response to a previously created client.
 * @param {number} index Position of the client in the current test.
 * @param {object} response Token response passed to the client's callback.
 */
function respond(index = 0, response = { access_token: 'new-token', expires_in: 3600 }) {
  clients[index].callback(response)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  clients = []
  initTokenClient = vi.fn(options => {
    const client = { ...options, requestAccessToken: vi.fn() }
    clients.push(client)
    return client
  })
  revoke = vi.fn()
  vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient, revoke } } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ email: 'alice@example.com' }) }))
})

describe('useAuth', () => {
  it('starts signed out when there is no session', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ accessToken: null, userEmail: null, error: null })
    expect(initTokenClient).not.toHaveBeenCalled()
  })

  it('restores the stored session and reuses a valid token without Google', async () => {
    storeSession()
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ accessToken: 'stored-token', userEmail: 'alice@example.com' })
    await expect(result.current.getValidAccessToken()).resolves.toBe('stored-token')
    expect(initTokenClient).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('signs in interactively, persists token expiry, and loads the email', async () => {
    const { result } = renderHook(() => useAuth())
    let signingIn
    act(() => { signingIn = result.current.signIn() })
    expect(clients[0].requestAccessToken).toHaveBeenCalledWith({})
    expect(clients[0].scope).toBe('https://www.googleapis.com/auth/calendar.readonly email profile')
    await act(async () => {
      respond()
      await signingIn
    })

    expect(result.current).toMatchObject({ accessToken: 'new-token', userEmail: 'alice@example.com', error: null })
    expect(sessionStorage.getItem('gis_access_token')).toBe('new-token')
    expect(sessionStorage.getItem('gis_expires_at')).toBe(String(NOW + 3_600_000))
    expect(sessionStorage.getItem('gis_user_email')).toBe('alice@example.com')
    expect(fetch).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer new-token' },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps sign-in successful when the profile fetch fails', async () => {
    fetch.mockRejectedValueOnce(new Error('Offline'))
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const signingIn = result.current.signIn()
      respond()
      await signingIn
    })
    expect(result.current).toMatchObject({ accessToken: 'new-token', userEmail: null, error: null })
  })

  it.each([
    ['expired', NOW - 1],
    ['at the refresh buffer', NOW + 300_000],
    ['missing', null],
  ])('silently refreshes a token whose expiry is %s without changing the email', async (_label, expiry) => {
    storeSession(expiry)
    if (expiry === null) sessionStorage.removeItem('gis_expires_at')
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const token = result.current.getValidAccessToken()
      expect(clients[0].requestAccessToken).toHaveBeenCalledWith({ prompt: 'none' })
      respond()
      await expect(token).resolves.toBe('new-token')
    })
    expect(result.current).toMatchObject({ accessToken: 'new-token', userEmail: 'alice@example.com' })
    expect(sessionStorage.getItem('gis_expires_at')).toBe(String(NOW + 3_600_000))
    expect(sessionStorage.getItem('gis_user_email')).toBe('alice@example.com')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forces a silent refresh even when the stored token is valid', async () => {
    storeSession()
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const token = result.current.getValidAccessToken({ forceRefresh: true })
      expect(clients[0].requestAccessToken).toHaveBeenCalledWith({ prompt: 'none' })
      respond()
      await expect(token).resolves.toBe('new-token')
    })
    expect(result.current.accessToken).toBe('new-token')
  })

  it('shares an in-flight refresh and permits a new request after completion', async () => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const first = result.current.getValidAccessToken()
      const second = result.current.getValidAccessToken()
      expect(initTokenClient).toHaveBeenCalledTimes(1)
      respond()
      await expect(Promise.all([first, second])).resolves.toEqual(['new-token', 'new-token'])
    })
    await act(async () => {
      const next = result.current.getValidAccessToken({ forceRefresh: true })
      expect(initTokenClient).toHaveBeenCalledTimes(2)
      respond(1, { access_token: 'next-token', expires_in: 3600 })
      await expect(next).resolves.toBe('next-token')
    })
  })

  it.each([
    ['OAuth denial', client => client.callback({ error: 'access_denied' }), 'access_denied'],
    ['popup closed', client => client.error_callback({ type: 'popup_closed' }), 'popup_closed'],
    ['unknown popup failure', client => client.error_callback({}), 'auth_error'],
  ])('reports %s and clears the error on the next sign-in', async (_label, fail, message) => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const signingIn = result.current.signIn()
      fail(clients[0])
      await signingIn
    })
    expect(result.current.error).toBe(message)
    expect(result.current.accessToken).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    let retry
    act(() => { retry = result.current.signIn() })
    expect(result.current.error).toBeNull()
    await act(async () => {
      respond(1)
      await retry
    })
    expect(result.current.accessToken).toBe('new-token')
  })

  it('reports when the Google SDK has not loaded', async () => {
    vi.stubGlobal('google', undefined)
    const { result } = renderHook(() => useAuth())
    await act(async () => { await result.current.signIn() })
    expect(result.current.error).toBe('Google sign-in is not ready yet. Please try again in a moment.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('clears a failed refresh session and rejects for every waiting caller', async () => {
    storeSession(NOW - 1)
    sessionStorage.setItem('unrelated', 'keep')
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const first = result.current.getValidAccessToken()
      const second = result.current.getValidAccessToken()
      const outcomes = Promise.allSettled([first, second])
      clients[0].callback({ error: 'login_required' })
      for (const outcome of await outcomes) {
        expect(outcome.status).toBe('rejected')
        expect(outcome.reason.message).toBe('login_required')
      }
    })
    expect(result.current).toMatchObject({
      accessToken: null, userEmail: null, error: 'Your session has expired. Please sign in again.',
    })
    expect(sessionStorage.getItem('gis_access_token')).toBeNull()
    expect(sessionStorage.getItem('gis_expires_at')).toBeNull()
    expect(sessionStorage.getItem('gis_user_email')).toBeNull()
    expect(sessionStorage.getItem('unrelated')).toBe('keep')
  })

  it('times out a stalled request and allows another attempt', async () => {
    const { result } = renderHook(() => useAuth())
    let signingIn
    act(() => { signingIn = result.current.signIn() })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999)
    })
    expect(result.current.error).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await signingIn
    })
    expect(result.current.error).toBe('Google sign-in request timed out.')
    await act(async () => {
      const retry = result.current.signIn()
      respond(1)
      await retry
    })
    expect(result.current.accessToken).toBe('new-token')
  })

  it('ignores a token callback arriving after the request timed out', async () => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const signingIn = result.current.signIn()
      await vi.advanceTimersByTimeAsync(10_000)
      await signingIn
    })
    await act(async () => { respond() })
    expect(result.current.accessToken).toBeNull()
    expect(sessionStorage.getItem('gis_access_token')).toBeNull()
    expect(sessionStorage.getItem('gis_expires_at')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a storage failure without publishing the new token', async () => {
    const { result } = renderHook(() => useAuth())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    await act(async () => {
      const signingIn = result.current.signIn()
      respond()
      await signingIn
    })
    expect(result.current.error).toBe('Storage unavailable')
    expect(result.current.accessToken).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('revokes the stored token and clears only authentication state on sign-out', () => {
    storeSession()
    sessionStorage.setItem('unrelated', 'keep')
    const { result } = renderHook(() => useAuth())
    act(() => { result.current.signOut() })
    expect(revoke).toHaveBeenCalledWith('stored-token', expect.any(Function))
    expect(result.current).toMatchObject({ accessToken: null, userEmail: null })
    expect(sessionStorage.getItem('gis_access_token')).toBeNull()
    expect(sessionStorage.getItem('gis_expires_at')).toBeNull()
    expect(sessionStorage.getItem('gis_user_email')).toBeNull()
    expect(sessionStorage.getItem('unrelated')).toBe('keep')
  })

  it('allows sign-out without a stored token', () => {
    const { result } = renderHook(() => useAuth())
    act(() => { result.current.signOut() })
    expect(revoke).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ accessToken: null, userEmail: null })
  })

  it('does not restore the email if a profile request finishes after sign-out', async () => {
    const profile = deferred()
    fetch.mockReturnValueOnce(profile.promise)
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const signingIn = result.current.signIn()
      respond()
      await signingIn
    })
    act(() => { result.current.signOut() })
    await act(async () => {
      profile.resolve({ json: async () => ({ email: 'alice@example.com' }) })
    })
    expect(result.current).toMatchObject({ accessToken: null, userEmail: null })
    expect(sessionStorage.getItem('gis_user_email')).toBeNull()
  })

  it('does not restore a session when a silent refresh completes after sign-out', async () => {
    storeSession(NOW - 1)
    const { result } = renderHook(() => useAuth())
    let outcome
    act(() => {
      outcome = result.current.getValidAccessToken().catch(error => error)
      result.current.signOut()
    })
    await act(async () => {
      respond()
      expect((await outcome).message).toBe('Google sign-in was cancelled.')
    })
    expect(result.current).toMatchObject({ accessToken: null, userEmail: null, error: null })
    expect(sessionStorage.getItem('gis_access_token')).toBeNull()
    expect(sessionStorage.getItem('gis_expires_at')).toBeNull()
    expect(sessionStorage.getItem('gis_user_email')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts a new sign-in immediately after cancelling a pending request', async () => {
    const { result } = renderHook(() => useAuth())
    let first
    let second
    act(() => {
      first = result.current.signIn()
      result.current.signOut()
      second = result.current.signIn()
    })
    expect(initTokenClient).toHaveBeenCalledTimes(2)
    await act(async () => {
      respond(0, { access_token: 'stale-token', expires_in: 3600 })
      respond(1)
      await Promise.all([first, second])
    })
    expect(result.current).toMatchObject({ accessToken: 'new-token', userEmail: 'alice@example.com', error: null })
    expect(sessionStorage.getItem('gis_access_token')).toBe('new-token')
  })

  it('preserves the email while a silent refresh overlaps a pending profile request', async () => {
    const profile = deferred()
    fetch.mockReturnValueOnce(profile.promise)
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      const signingIn = result.current.signIn()
      respond()
      await signingIn
    })
    await act(async () => {
      const refresh = result.current.getValidAccessToken({ forceRefresh: true })
      respond(1, { access_token: 'refreshed-token', expires_in: 3600 })
      await refresh
      profile.resolve({ json: async () => ({ email: 'alice@example.com' }) })
    })
    expect(result.current).toMatchObject({ accessToken: 'refreshed-token', userEmail: 'alice@example.com' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
