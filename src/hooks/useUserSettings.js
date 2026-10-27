import { useState, useEffect, useCallback, useRef } from 'react'
import { loadUserSettings, saveUserSettings } from '../lib/userSettings.js'

export function useUserSettings(userEmail) {
  const [settings, setSettings] = useState({ custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '', paid_cancellation_phrases: null, cancelled_keywords: null })
  const [isReady, setIsReady] = useState(false)
  const userGeneration = useRef(0)

  useEffect(() => {
    const generation = ++userGeneration.current
    setIsReady(false)
    if (!userEmail) return
    loadUserSettings(userEmail).then(s => {
      if (userGeneration.current !== generation) return
      setSettings(s)
      setIsReady(true)
    })
    return () => { userGeneration.current++ }
  }, [userEmail])

  const saveSettings = useCallback(async (next) => {
    if (!userEmail) return
    // Persist BEFORE updating in-memory state. If saveUserSettings throws
    // (e.g. localStorage quota exceeded), state must stay at the
    // last-persisted value so a caller's dirty/unsaved-changes check stays
    // truthful — setting state first would make a failed save look saved.
    const generation = userGeneration.current
    await saveUserSettings(userEmail, next)
    if (userGeneration.current === generation) setSettings(next)
  }, [userEmail])

  return { settings, saveSettings, isReady }
}
