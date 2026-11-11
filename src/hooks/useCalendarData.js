import { useState, useCallback, useRef } from 'react'
import { fetchCalendarEvents } from '../api/calendarApi.js'
import { calculatePayments, monthWindow } from '../lib/calendarPayments.js'

/**
 * Fetch calendar events and calculate lesson payments for a selected month.
 * @param {Function} getAccessToken Supplies a valid Google access token.
 * @param {object|null} config Calendar and pricing configuration.
 * @returns {{rows: Array|null, summary: object|null, loading: boolean, error: string|null, calculate: Function, reset: Function, calculatedWith: object|null}} Calculation state and actions; reset clears it and discards any run in flight; calculatedWith is the config the rows came from.
 */
export function useCalendarData(getAccessToken, config) {
  const [rows, setRows] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [calculatedWith, setCalculatedWith] = useState(null)
  // Bumped by every calculate() and reset(); a run that finishes after a newer
  // one started (or after a reset on account switch) is discarded.
  const runRef = useRef(0)

  const calculate = useCallback(async (monthStr) => {
    // getAccessToken is a function reference, always truthy once wired up —
    // only the !config half of this guard can actually fire in practice.
    // Left over from the original !accessToken (nullable string) check.
    if (!getAccessToken || !config) return
    const run = ++runRef.current
    setLoading(true)
    setError(null)
    try {
      const { start, end } = monthWindow(monthStr)
      // Fetch 3-month window for regularity detection
      const windowStart = new Date(start)
      // monthWindow returns UTC boundaries; local month arithmetic can shift
      // the date across month ends or daylight-saving transitions.
      windowStart.setUTCMonth(windowStart.getUTCMonth() - 2)
      const events = await fetchCalendarEvents(
        getAccessToken,
        config.calendar_id ?? 'primary',
        windowStart,
        end,
      )
      if (run !== runRef.current) return
      const result = calculatePayments(events, config, monthStr)
      setRows(result.rows)
      setSummary(result.summary)
      setCalculatedWith(config)
    } catch (err) {
      if (run === runRef.current) setError(err.message ?? String(err))
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }, [getAccessToken, config])

  const reset = useCallback(() => {
    runRef.current++
    setLoading(false)
    setRows(null)
    setSummary(null)
    setCalculatedWith(null)
    setError(null)
  }, [])

  return { rows, summary, loading, error, calculate, reset, calculatedWith }
}
