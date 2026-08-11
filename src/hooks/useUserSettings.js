import { useState, useEffect, useCallback } from 'react'
import { loadUserSettings, saveUserSettings } from '../lib/userSettings.js'

export function useUserSettings(userEmail) {
  const [settings, setSettings] = useState({ custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '', paid_cancellation_phrases: null, cancelled_keywords: null })
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (!userEmail) return
    setIsReady(false)
    loadUserSettings(userEmail).then(s => {
      setSettings(s)
      setIsReady(true)
    })
  }, [userEmail])

  const saveSettings = useCallback(async (next) => {
    if (!userEmail) return
    // Persist BEFORE updating in-memory state. If saveUserSettings throws
    // (e.g. localStorage quota exceeded), state must stay at the
    // last-persisted value so a caller's dirty/unsaved-changes check stays
    // truthful — setting state first would make a failed save look saved.
    await saveUserSettings(userEmail, next)
    setSettings(next)
  }, [userEmail])

  return { settings, saveSettings, isReady }
}
