const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export function formatCalendarApiError(status, bodyText) {
  let message = null
  try {
    message = JSON.parse(bodyText)?.error?.message ?? null
  } catch {
    // not JSON, fall through with message left as null
  }
  if (status === 401) return 'Your Google session has expired. Please sign in again.'
  if (status === 403) {
    return message
      ? `Calendar access denied: ${message}`
      : 'Calendar access denied — check calendar sharing permissions.'
  }
  return message
    ? `Failed to load calendar events: ${message}`
    : `Failed to load calendar events (error ${status}).`
}

export async function fetchCalendarEvents(getAccessToken, calendarId, timeMin, timeMax) {
  const events = []
  let pageToken = null
  let retried = false

  // Explicit while(true)/break rather than do...while(pageToken): a `continue`
  // inside a do...while jumps to the condition check, not the top of the
  // body, so retrying page 1 (where pageToken is still null) would exit the
  // loop instead of re-fetching. This structure makes `continue` always
  // re-run the loop body regardless of pageToken's current value.
  while (true) {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: '2500',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const token = await getAccessToken()
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 401 && !retried) {
      retried = true
      await getAccessToken({ forceRefresh: true })
      continue
    }

    if (!res.ok) {
      const body = await res.text()
      throw new Error(formatCalendarApiError(res.status, body))
    }

    const data = await res.json()
    if (data.items) events.push(...data.items)
    pageToken = data.nextPageToken ?? null
    if (!pageToken) break
  }

  return events
}
