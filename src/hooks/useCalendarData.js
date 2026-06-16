import { useState, useCallback } from 'react'
import { fetchCalendarEvents } from '../api/calendarApi.js'
import { calculatePayments, monthWindow } from '../lib/calendarPayments.js'

export function useCalendarData(accessToken, config) {
  const [rows, setRows] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const calculate = useCallback(async (monthStr) => {
    if (!accessToken || !config) return
    setLoading(true)
    setError(null)
    try {
      const { start, end } = monthWindow(monthStr)
      // Fetch 3-month window for regularity detection
      const windowStart = new Date(start)
      windowStart.setMonth(windowStart.getMonth() - 2)
      const events = await fetchCalendarEvents(
        accessToken,
        config.calendar_id ?? 'primary',
        windowStart,
        end,
      )
      const result = calculatePayments(events, config, monthStr)
      setRows(result.rows)
      setSummary(result.summary)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }, [accessToken, config])

  return { rows, summary, loading, error, calculate }
}
