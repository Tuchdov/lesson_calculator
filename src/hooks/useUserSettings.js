import { useState, useEffect, useCallback, useRef } from 'react'
import { loadUserSettings, saveUserSettings } from '../lib/userSettings.js'

/**
 * Load and save settings for the signed-in user, ignoring stale async results
 * after the user changes. A save updates state only after persistence succeeds.
 * @param {string|null} userEmail The signed-in user's email, or null.
 * @returns {{settings: object, saveSettings: Function, isReady: boolean}} Settings, persistence action, and loading status.
 */
export function useUserSettings(userEmail) {
  const [settings, setSettings] = useState({ custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '', paid_cancellation_phrases: null, cancelled_keywords: null })
  const [isReady, setIsReady] = useState(false)
  const [previousEmail, setPreviousEmail] = useState(userEmail)
  const userGeneration = useRef(0)

  if (previousEmail !== userEmail) {
    setPreviousEmail(userEmail)
    setIsReady(false)
  }

  useEffect(() => {
    const generationRef = userGeneration
    const generation = ++generationRef.current
    if (!userEmail) return
    loadUserSettings(userEmail).then(s => {
      if (generationRef.current !== generation) return
      setSettings(s)
      setIsReady(true)
    })
    return () => { generationRef.current++ }
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
