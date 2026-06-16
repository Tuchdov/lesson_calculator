import { useState, useCallback } from 'react'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

export function useAuth() {
  const [accessToken, setAccessToken] = useState(
    () => sessionStorage.getItem('gis_access_token')
  )
  const [userEmail, setUserEmail] = useState(
    () => sessionStorage.getItem('gis_user_email')
  )
  const [error, setError] = useState(null)

  const signIn = useCallback(() => {
    setError(null)
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/calendar.readonly email profile',
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          setError(tokenResponse.error)
          return
        }
        const token = tokenResponse.access_token
        sessionStorage.setItem('gis_access_token', token)
        setAccessToken(token)

        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => r.json())
          .then(info => {
            const email = info.email ?? ''
            sessionStorage.setItem('gis_user_email', email)
            setUserEmail(email)
          })
          .catch(() => {})
      },
    })
    client.requestAccessToken()
  }, [])

  const signOut = useCallback(() => {
    const token = sessionStorage.getItem('gis_access_token')
    if (token) google.accounts.oauth2.revoke(token, () => {})
    sessionStorage.removeItem('gis_access_token')
    sessionStorage.removeItem('gis_user_email')
    setAccessToken(null)
    setUserEmail(null)
  }, [])

  return { accessToken, userEmail, signIn, signOut, error }
}
