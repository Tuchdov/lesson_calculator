import { useState, useEffect, useCallback } from 'react'
import { loadUserSettings, saveUserSettings } from '../lib/userSettings.js'

export function useUserSettings(userEmail) {
  const [settings, setSettings] = useState({ custom_prices: {}, customer_details: {} })
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
    setSettings(next)
    await saveUserSettings(userEmail, next)
  }, [userEmail])

  return { settings, saveSettings, isReady }
}
