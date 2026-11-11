import { useState, useEffect, useCallback } from 'react'
import { loadUserSettings, updateUserSettings, settingsStorageKey } from '../lib/userSettings.js'

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

  // Another tab saved settings — pick them up so this tab's in-memory copy
  // doesn't go stale.
  useEffect(() => {
    if (!userEmail) return
    let cancelled = false
    let key = null
    settingsStorageKey(userEmail).then(k => { key = k })
    const onStorage = (e) => {
      if (!key || e.key !== key) return
      loadUserSettings(userEmail).then(s => { if (!cancelled) setSettings(s) })
    }
    window.addEventListener('storage', onStorage)
    return () => {
      cancelled = true
      window.removeEventListener('storage', onStorage)
    }
  }, [userEmail])

  // `updater` receives the settings as currently stored (not this tab's
  // possibly-stale copy) and returns the full next settings object.
  const saveSettings = useCallback(async (updater) => {
    if (!userEmail) return
    // Persist BEFORE updating in-memory state. If saving throws
    // (e.g. localStorage quota exceeded), state must stay at the
    // last-persisted value so a caller's dirty/unsaved-changes check stays
    // truthful — setting state first would make a failed save look saved.
    const next = await updateUserSettings(userEmail, updater)
    setSettings(next)
  }, [userEmail])

  return { settings, saveSettings, isReady }
}
