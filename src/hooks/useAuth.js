import { useState, useCallback, useRef } from 'react'
import { computeExpiresAt, isTokenExpired } from '../lib/tokenExpiry.js'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const TOKEN_REQUEST_TIMEOUT_MS = 10_000

const SESSION_KEYS = {
  TOKEN: 'gis_access_token',
  EXPIRES_AT: 'gis_expires_at',
  EMAIL: 'gis_user_email',
}

export function useAuth() {
  const [accessToken, setAccessToken] = useState(
    () => sessionStorage.getItem(SESSION_KEYS.TOKEN)
  )
  const [userEmail, setUserEmail] = useState(
    () => sessionStorage.getItem(SESSION_KEYS.EMAIL)
  )
  const [error, setError] = useState(null)
  const inFlightRef = useRef(null)

  // Creates a fresh GIS token client per call (cheap — no network/UI cost)
  // instead of retaining one instance with a shared callback. Each request
  // gets its own callback closing over that request's resolve/reject, so
  // there is no shared mutable slot that could route the wrong response to
  // the wrong caller, and the silent-refresh path never touches userEmail
  // (only signIn's userinfo fetch does).
  const requestToken = useCallback(({ interactive }) => {
    if (inFlightRef.current) return inFlightRef.current

    const promise = new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error('Google sign-in is not ready yet. Please try again in a moment.'))
        return
      }

      let settled = false
      const timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Google sign-in request timed out.'))
      }, TOKEN_REQUEST_TIMEOUT_MS)

      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        fn(value)
      }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/calendar.readonly email profile',
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            settle(reject, new Error(tokenResponse.error))
            return
          }
          const token = tokenResponse.access_token
          const expiresAt = computeExpiresAt(tokenResponse.expires_in)
          try {
            sessionStorage.setItem(SESSION_KEYS.TOKEN, token)
            sessionStorage.setItem(SESSION_KEYS.EXPIRES_AT, String(expiresAt))
          } catch (err) {
            settle(reject, err)
            return
          }
          setAccessToken(token)
          settle(resolve, token)
        },
        error_callback: (err) => {
          settle(reject, new Error(err?.type ?? 'auth_error'))
        },
      })
      client.requestAccessToken(interactive ? {} : { prompt: 'none' })
    })

    inFlightRef.current = promise
    promise.finally(() => {
      inFlightRef.current = null
    })
    return promise
  }, [])

  const signIn = useCallback(async () => {
    setError(null)
    try {
      const token = await requestToken({ interactive: true })
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(info => {
          const email = info.email ?? ''
          sessionStorage.setItem(SESSION_KEYS.EMAIL, email)
          setUserEmail(email)
        })
        .catch(() => {})
    } catch (err) {
      setError(err.message ?? String(err))
    }
  }, [requestToken])

  const getValidAccessToken = useCallback(async ({ forceRefresh = false } = {}) => {
    const storedToken = sessionStorage.getItem(SESSION_KEYS.TOKEN)
    const storedExpiresAt = Number(sessionStorage.getItem(SESSION_KEYS.EXPIRES_AT)) || null
    if (!forceRefresh && storedToken && !isTokenExpired(storedExpiresAt)) {
      return storedToken
    }
    try {
      return await requestToken({ interactive: false })
    } catch (err) {
      sessionStorage.removeItem(SESSION_KEYS.TOKEN)
      sessionStorage.removeItem(SESSION_KEYS.EXPIRES_AT)
      sessionStorage.removeItem(SESSION_KEYS.EMAIL)
      setAccessToken(null)
      setUserEmail(null)
      setError('Your session has expired. Please sign in again.')
      throw err
    }
  }, [requestToken])

  const signOut = useCallback(() => {
    const token = sessionStorage.getItem(SESSION_KEYS.TOKEN)
    if (token) google.accounts.oauth2.revoke(token, () => {})
    sessionStorage.removeItem(SESSION_KEYS.TOKEN)
    sessionStorage.removeItem(SESSION_KEYS.EXPIRES_AT)
    sessionStorage.removeItem(SESSION_KEYS.EMAIL)
    setAccessToken(null)
    setUserEmail(null)
  }, [])

  return { accessToken, userEmail, signIn, signOut, error, getValidAccessToken }
}
